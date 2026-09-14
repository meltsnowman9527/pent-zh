import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FlowJobStatus, isFlowJobPending } from './flow-job-status';

const job = {
    attempts: 0,
    correlationId: 'delete-test',
    error: null,
    id: '1',
    kind: 'delete',
    maxAttempts: 3,
    status: 'queued',
    step: 'queued',
};

describe('lifecycle status', () => {
    it('shows acceptance without claiming completion', () => {
        render(<FlowJobStatus job={job} />);
        expect(screen.getByRole('status')).toHaveTextContent('删除：等待处理');
        expect(isFlowJobPending(job)).toBe(true);
        expect(isFlowJobPending({ ...job, status: 'failed' })).toBe(false);
    });
    it('keeps raw failure diagnostics in a disclosure', () => {
        render(<FlowJobStatus job={{ ...job, error: 'unexpected upstream response', status: 'failed' }} />);
        expect(screen.getByText('删除：处理失败')).toBeInTheDocument();
        expect(screen.getByText('操作未完成，请稍后重试')).toBeInTheDocument();
        expect(screen.getByText('unexpected upstream response').closest('details')).not.toHaveAttribute('open');
    });
});
