import { skipToken, useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import Logo from '@/components/icons/logo';
import Markdown from '@/components/shared/markdown';
import { AssistantLogsDocument, FlowReportDocument, GenerateAssistantReportDocument } from '@/graphql/types';
import { Log } from '@/lib/log';
import {
    findAssistantReport,
    generateFileName,
    generateFlowReport,
    generatePDFFromMarkdown,
} from '@/lib/report';
import { uiText } from '@/locales/zh-CN';

type PdfPhase = 'done' | 'error' | 'idle';
type ReportState = 'content' | 'error' | 'generating' | 'loading';

function FlowReport() {
    const { flowId } = useParams<{ flowId: string }>();
    const [searchParams] = useSearchParams();
    const download = searchParams.has('download');
    const silent = searchParams.has('silent');
    const assistantIdParam = searchParams.get('assistantId');

    const [pdfPhase, setPdfPhase] = useState<PdfPhase>('idle');
    const [pdfError, setPdfError] = useState<null | string>(null);
    const pdfTriggered = useRef(false);

    const [prevFlowId, setPrevFlowId] = useState(flowId);

    if (flowId !== prevFlowId) {
        setPrevFlowId(flowId);
        setPdfPhase('idle');
        setPdfError(null);
    }

    const { data, loading } = useQuery(
        FlowReportDocument,
        flowId ? { errorPolicy: 'all', variables: { id: flowId } } : skipToken,
    );

    // Under `errorPolicy:'all'` a partial error arrives alongside a flow that loaded fine.
    const flowReady = !loading && !!data?.flow;
    const taskCount = (data?.tasks ?? []).length;

    // Task reports are the automation-mode shape; a flow without tasks is an assistant
    // conversation, whose transcript lives in the assistant logs.
    const needsAssistantLogs = flowReady && taskCount === 0;

    // The API serialises `ID` as a JSON number while this page's own assistant id comes
    // from the URL as a string, so both sides are normalised before they meet.
    const firstAssistantId = data?.assistants?.[0]?.id;
    const reportAssistantId =
        assistantIdParam ?? (firstAssistantId === null || firstAssistantId === undefined ? null : String(firstAssistantId));

    const {
        data: assistantLogsData,
        loading: isAssistantLogsLoading,
        refetch: refetchAssistantLogs,
    } = useQuery(
        AssistantLogsDocument,
        needsAssistantLogs && reportAssistantId
            ? { variables: { assistantId: reportAssistantId, flowId: flowId ?? '' } }
            : skipToken,
    );

    // The session's written report is what the exports must carry; without one the
    // page offers to write it instead of pretending the transcript is a report.
    const hasWrittenReport = !!findAssistantReport(assistantLogsData?.assistantLogs);

    const [generateReport, { loading: isGeneratingReport }] = useMutation(GenerateAssistantReportDocument);

    const handleGenerateReport = async () => {
        if (!flowId || !reportAssistantId) {
            return;
        }

        try {
            const result = await generateReport({
                variables: { assistantId: reportAssistantId, flowId },
            });

            if (result.data?.generateAssistantReport.markdown) {
                await refetchAssistantLogs();
                toast.success(uiText('Analysis report generated'));
            }
        } catch (error) {
            Log.error('Failed to generate analysis report:', error);
            toast.error(uiText('Failed to generate analysis report'));
        }
    };

    // Generating the PDF before the transcript arrives would export an empty report.
    const dataReady = flowReady && !(needsAssistantLogs && isAssistantLogsLoading);

    const reportContent = useMemo(() => {
        const flow = data?.flow;

        if (!dataReady || !flow) {
            return '';
        }

        return generateFlowReport({
            assistant: data?.assistants?.find((item) => String(item.id) === reportAssistantId),
            assistantLogs: assistantLogsData?.assistantLogs,
            flow,
            tasks: data?.tasks,
        });
    }, [assistantLogsData, data, dataReady, reportAssistantId]);

    useEffect(() => {
        pdfTriggered.current = false;
    }, [flowId]);

    useEffect(() => {
        if (!dataReady || !download || pdfTriggered.current || !data?.flow) {
            return;
        }

        pdfTriggered.current = true;

        // The generator appends the extension itself.
        const fileName = generateFileName(data.flow);

        generatePDFFromMarkdown(reportContent, fileName)
            .then(() => {
                if (silent) {
                    setTimeout(() => window.close(), 1000);
                } else {
                    setPdfPhase('done');
                }
            })
            .catch((err) => {
                Log.error(uiText('PDF generation failed:'), err);
                setPdfError(uiText('Failed to generate PDF'));
                setPdfPhase('error');
            });
    }, [dataReady, download, silent, reportContent, data]);

    let state: ReportState;
    let errorMessage: null | string = null;

    if (loading || (needsAssistantLogs && isAssistantLogsLoading)) {
        state = 'loading';
    } else if (!data?.flow) {
        state = 'error';
        errorMessage = uiText('Failed to load flow data');
    } else if (pdfPhase === 'error') {
        state = 'error';
        errorMessage = pdfError;
    } else if (download && pdfPhase !== 'done') {
        state = 'generating';
    } else {
        state = 'content';
    }

    if (state === 'loading' || state === 'generating') {
        return (
            <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
                <div className="flex min-h-screen flex-col items-center justify-center p-8">
                    <Logo className="animate-logo-spin mb-8 size-16 text-white" />
                    <div className="flex flex-col gap-4 text-center">
                        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                            {state === 'loading' ? uiText('Loading Report...') : uiText('Generating PDF...')}
                        </h1>
                        <div className="mx-auto size-8 animate-spin rounded-full border-b-2 border-blue-600" />
                        <p className="max-w-md text-gray-600 dark:text-gray-400">
                            {state === 'loading'
                                ? uiText('Please wait while we prepare your penetration testing report.')
                                : uiText('Creating your PDF document. This may take a few moments.')}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (state === 'error') {
        return (
            <div className="min-h-screen bg-linear-to-br from-red-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
                <div className="flex min-h-screen flex-col items-center justify-center p-8">
                    <Logo className="mb-8 size-16" />
                    <div className="flex flex-col gap-4 text-center">
                        <h1 className="text-2xl font-semibold text-red-600 dark:text-red-400">
                            {uiText('Error Loading Report')}
                        </h1>
                        <p className="max-w-md text-gray-600 dark:text-gray-400">
                            {errorMessage || uiText('An unexpected error occurred while loading the report.')}
                        </p>
                        <button
                            className="mt-4 rounded-md bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
                            onClick={() => window.close()}
                        >
                            {uiText('Close')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <div className="h-screen w-full overflow-auto p-8">
                <div className="mx-auto max-w-4xl">
                    {needsAssistantLogs && reportAssistantId && (
                        <div className="mb-6 flex items-center justify-end gap-3 print:hidden">
                            <button
                                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
                                disabled={isGeneratingReport}
                                onClick={() => void handleGenerateReport()}
                                type="button"
                            >
                                {isGeneratingReport
                                    ? uiText('Generating analysis report...')
                                    : hasWrittenReport
                                      ? uiText('Regenerate analysis report')
                                      : uiText('Generate analysis report')}
                            </button>
                        </div>
                    )}
                    <div className="prose prose-slate dark:prose-invert max-w-none">
                        <Markdown>{reportContent}</Markdown>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default FlowReport;
