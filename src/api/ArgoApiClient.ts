import { WorkflowManifest, WorkflowResponse, ApiResponse, ArgoClientError } from '../types/argo';

class ArgoApiClient {
  private baseUrl: string;
  private authToken: string | null;
  private defaultNamespace: string;

  constructor(baseUrl: string = 'http://localhost:2746', authToken: string | null = null, defaultNamespace: string = 'default') {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
    this.defaultNamespace = defaultNamespace;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  private async request<T>(
    method: string,
    path: string,
    data?: any
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const config: RequestInit = {
      method: method,
      headers: headers,
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, config);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = await response.text();
        }
        throw new ArgoClientError(
          `Argo API Error: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error: any) {
      if (error instanceof ArgoClientError) {
        throw error;
      }
      throw new ArgoClientError(`Network or unexpected error: ${error.message}`);
    }
  }

  public async submitWorkflow(
    workflowManifest: WorkflowManifest,
    namespace: string = this.defaultNamespace
  ): Promise<WorkflowResponse> {
    const path = `/api/v1/workflows/${namespace}`;
    return this.request<WorkflowResponse>('POST', path, workflowManifest);
  }

  public async getWorkflow(
    name: string,
    namespace: string = this.defaultNamespace
  ): Promise<WorkflowResponse> {
    const path = `/api/v1/workflows/${namespace}/${name}`;
    return this.request<WorkflowResponse>('GET', path);
  }

  public async listWorkflows(
    namespace: string = this.defaultNamespace
  ): Promise<ApiResponse<WorkflowResponse>> {
    const path = `/api/v1/workflows/${namespace}`;
    return this.request<ApiResponse<WorkflowResponse>>('GET', path);
  }

  public async deleteWorkflow(
    name: string,
    namespace: string = this.defaultNamespace
  ): Promise<void> {
    const path = `/api/v1/workflows/${namespace}/${name}`;
    await this.request<void>('DELETE', path);
  }

  public streamWorkflowEvents(
    namespace: string = this.defaultNamespace
  ): EventSource {
    const url = `${this.baseUrl}/api/v1/workflow-events/${namespace}`;
    const eventSource = new EventSource(url);
    
    return eventSource;
  }

  public async getWorkflowLogs(
    workflowName: string,
    podName: string,
    namespace: string = this.defaultNamespace
  ): Promise<string> {
    const path = `/api/v1/workflows/${namespace}/${workflowName}/${podName}/log`;
    return this.request<string>('GET', path);
  }
}

export default ArgoApiClient;
