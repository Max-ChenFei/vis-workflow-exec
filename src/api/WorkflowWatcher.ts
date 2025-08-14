import { WorkflowStatus, WorkflowNodeStatus, ArgoStreamingResponse } from './types';


export class WorkflowWatcher {
  private eventSource: EventSource | null = null;
  private readonly namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  watch(
    workflowName: string,
    onUpdate: (data: WorkflowStatus) => void,
    onOpen?: () => void,
    onClose?: () => void,
    onError?: (error: Event) => void
  ): () => void {
    this.stop();

    const url = `/api/v1/workflow-events/${encodeURIComponent(this.namespace)}?listOptions.fieldSelector=${encodeURIComponent(`metadata.name=${workflowName}`)}&listOptions.resourceVersion=0`;
    console.log('Connecting to EventSource:', url);
    
    this.eventSource = new EventSource(url);
    this.eventSource.onopen = (event) => {
      console.log('Workflow event stream connected', event);
      onOpen?.();
    };

    this.eventSource.onmessage = (event) => {
      console.log('Raw event data:', event.data);
      try {
        if (!event.data || event.data.trim() === '') {
          console.log('Skipping empty event data');
          return;
        }

        const workflowEvent: ArgoStreamingResponse = JSON.parse(event.data).result;
    
        if (!workflowEvent || !workflowEvent.object || !workflowEvent.object.metadata) {
          console.log('Skipping invalid event structure:', workflowEvent);
          return;
        }

        const status: WorkflowStatus = extractWorkflowStatus(workflowEvent);
        onUpdate(status);
        
        if ((status.phase === 'Succeeded' || status.phase === 'Failed' || status.phase === 'Error')) {
          console.log(`Workflow ${status.name} completed with status: ${status.phase}. Auto-closing stream immediately.`);
          onClose?.();
          this.stop();
        }
      } catch (error) {
        console.error('Error parsing workflow event:', error, 'Raw data:', event.data);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('Workflow event stream error:', error);
      console.log('EventSource readyState:', this.eventSource?.readyState);
      onError?.(error);
    };

    return () => this.stop();
  }

  stop(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}


function extractWorkflowStatus(response: ArgoStreamingResponse): WorkflowStatus {
  const response_object = response.object;
  const name = response_object.metadata?.name || 'Unknown';
  const phase = response_object.status?.phase || 'Unknown';
  const nodes: WorkflowNodeStatus[] = [];
  if (response_object.status?.nodes) {
    Object.values(response_object.status.nodes)
      .filter((node: any) => node.type === 'Pod' || node.type === 'Container')
      .forEach((node: any) => {
        const taskPhase = node.phase || 'Unknown';
        const outputs = node.outputs?.parameters
          ? node.outputs.parameters.map((p: any) => p.value)
          : [];

        nodes.push({
          name: node.displayName || node.name,
          phase: taskPhase,
          outputs: outputs
        } as WorkflowNodeStatus);
      });
  }
  console.log('Extracted workflow data:', { name, phase, nodes });
  return { name, phase, nodes };
}

