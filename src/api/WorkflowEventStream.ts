import { WorkflowResponse } from '../types/argo';

export interface WorkflowEvent {
    type: string;
    object: WorkflowResponse;
}

export class WorkflowEventStream {
  private eventSource: EventSource | null = null;
  private currentWorkflowName: string | null = null;

  // Stream workflow events for a specific namespace
  streamWorkflowEvents(
    namespace: string,
    workflowName: string,
    onEvent: (event: WorkflowEvent) => void,
    onError?: (error: Event) => void,
    onOpen?: () => void
  ): () => void {
    // Close existing connection if any
    this.close();

    // Try the standard Argo workflow events endpoint
    // Note: EventSource doesn't support Authorization headers, so this might not work with auth
    const url = `/api/v1/workflow-events/${encodeURIComponent(namespace)}?listOptions.fieldSelector=${encodeURIComponent(`metadata.name=${workflowName}`)}&listOptions.resourceVersion=0`;

    console.log('Connecting to EventSource:', url);
    
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = (event) => {
      console.log('Workflow event stream connected', event);
      onOpen?.();
    };

    this.eventSource.onmessage = (event) => {
      console.log('Raw event data:', event.data);
      try {
        // Skip empty or invalid data
        if (!event.data || event.data.trim() === '') {
          console.log('Skipping empty event data');
          return;
        }

        const workflowEvent: WorkflowEvent = JSON.parse(event.data).result;
      
        // Validate that the event has the required structure
        if (!workflowEvent || !workflowEvent.object || !workflowEvent.object.metadata) {
          console.log('Skipping invalid event structure:', workflowEvent);
          return;
        }

        onEvent(workflowEvent);
      } catch (error) {
        console.error('Error parsing workflow event:', error, 'Raw data:', event.data);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('Workflow event stream error:', error);
      console.log('EventSource readyState:', this.eventSource?.readyState);
      onError?.(error);
    };

    // Return cleanup function
    return () => this.close();
  }

  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.currentWorkflowName = null;
    }
  }
}
