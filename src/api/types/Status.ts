export interface WorkflowStatus {
    name: string;
    phase: string;
    nodes: WorkflowNodeStatus[];
}


export interface WorkflowNodeStatus{
    name: string;
    phase: string;
    outputs: string[];
}
