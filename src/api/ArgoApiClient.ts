import { WorkflowManifest, WorkflowResponse, ApiResponse, ArgoClientError } from '../types/argo';

class ArgoApiClient {
  private baseUrl: string;
  private authToken: string | null;
  private defaultNamespace: string;

  constructor(baseUrl: string = '', authToken: string | null = null, defaultNamespace: string = 'default') {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
    this.defaultNamespace = defaultNamespace;
  }

  public setAuthToken(token: string | null): void {
    if (token) {
      token = token.replace(/%+$/, '').trim();
    }
    this.authToken = token;
  }

  // Health check method to verify connection to Argo server
  public async checkHealth(): Promise<{ isHealthy: boolean; error?: string }> {
    try {
      const headers: HeadersInit = {};
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      
      const response = await fetch(`${this.baseUrl}/api/v1/info`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'same-origin',
        headers
      });
      
      if (response.ok) {
        await response.json();
        return { isHealthy: true };
      } else {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (e) {
          
        }
        
        return { 
          isHealthy: false, 
          error: `Server responded with ${response.status}: ${response.statusText}${errorBody ? '\n' + errorBody : ''}` 
        };
      }
    } catch (error: any) {
      if (error.message && error.message.includes('ERR_CERT_AUTHORITY_INVALID')) {
        return { 
          isHealthy: false, 
          error: `SSL Certificate error. Please visit ${this.baseUrl} in your browser and accept the certificate, then try again.` 
        };
      }
      
      return { 
        isHealthy: false, 
        error: `Connection failed: ${error.message}` 
      };
    }
  }

  private async request<T>(
    method: string,
    path: string,
    data?: any,
    expectJson: boolean = true
  ): Promise<T> {
    const headers: HeadersInit = {};

    // Only add Content-Type header if we're sending data
    if (data) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const config: RequestInit = {
      method: method,
      headers: headers,
      mode: 'cors',
      credentials: 'same-origin',
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    const fullUrl = `${this.baseUrl}${path}`;
    
    try {
      const response = await fetch(fullUrl, config);

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

      if (expectJson) {
        try {
          const result = await response.json();
          return result;
        } catch (error) {
          const textResult = await response.text();
          return textResult as unknown as T;
        }
      } else {
        const textResult = await response.text();
        return textResult as unknown as T;
      }
    } catch (error: any) {
      // Handle SSL certificate errors specifically
      if (error.message && error.message.includes('ERR_CERT_AUTHORITY_INVALID')) {
        throw new ArgoClientError(
          'SSL Certificate Error: Please accept the self-signed certificate by visiting https://localhost:2747 in your browser and accepting the security warning, then try again.',
          0,
          { originalError: error.message }
        );
      }
      
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
    
    if (!workflowManifest.spec.serviceAccountName) {
      workflowManifest.spec.serviceAccountName = 'argo-workflow';
    }
    
    if (workflowManifest.metadata.namespace && workflowManifest.metadata.namespace !== namespace) {
      workflowManifest.metadata.namespace = namespace;
    } else if (!workflowManifest.metadata.namespace) {
      workflowManifest.metadata.namespace = namespace;
    }
    
    const requestBody = {
      workflow: workflowManifest,
      namespace: namespace
    };
    
    return this.request<WorkflowResponse>('POST', path, requestBody);
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

  public async getWorkflowLogs(
    workflowName: string,
    podName: string,
    namespace: string = this.defaultNamespace
  ): Promise<string> {
    const path = `/api/v1/workflows/${namespace}/${workflowName}/${podName}/log`;
    return await this.request<string>('GET', path, undefined, false);
  }

  public async deleteAllWorkflows(
    namespace: string = this.defaultNamespace
  ): Promise<{ deleted: number; errors: string[] }> {
    const result = { deleted: 0, errors: [] as string[] };
    
    try {
      // First, list all workflows in the namespace
      const response = await this.listWorkflows(namespace);
      
      if (!response.items || response.items.length === 0) {
        return result;
      }
      
      // Delete each workflow one by one
      for (const workflow of response.items) {
        if (!workflow.metadata?.name) {
          result.errors.push(`Workflow missing name: ${JSON.stringify(workflow.metadata)}`);
          continue;
        }
        
        try {
          const name = workflow.metadata.name;
          await this.deleteWorkflow(name, namespace);
          result.deleted++;
        } catch (error: any) {
          const errorMessage = `Failed to delete workflow ${workflow.metadata?.name}: ${error.message}`;
          result.errors.push(errorMessage);
        }
      }
      
      return result;
    } catch (error: any) {
      const errorMessage = `Failed to list or delete workflows: ${error.message}`;
      result.errors.push(errorMessage);
      return result;
    }
  }

  public async testConnection(namespace: string = this.defaultNamespace): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
      
      const path = `/api/v1/workflows/${namespace}`;
      const headers: HeadersInit = {};
      
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId); 
      
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
      
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('连接超时，请检查服务器是否可用');
      }
      throw error;
    }
  }

  public streamWorkflowEvents(
    namespace: string = this.defaultNamespace,
    callback: (event: any) => void,
    errorCallback?: (error: any) => void
  ): { stop: () => void, unsubscribe: () => void } {
    const url = `${this.baseUrl}/api/v1/workflows/${namespace}`;
    
    const controller = new AbortController();
    const signal = controller.signal;
    
    let latestResourceVersions: {[name: string]: string} = {};
    
    let isFetching = true;
    
    let lastFetchTime = 0;
    
    let refreshInterval = 2000;
    
    const processedNodes: {[nodeId: string]: boolean} = {};
    
    let errorCount = 0;
    
    // 最大连续错误次数
    const MAX_ERRORS = 5;
    
    // 添加连接超时
    let connectionTimeoutId: NodeJS.Timeout | null = null;
    
    // 设置连接超时，如果在指定时间内没有成功连接，则报错
    connectionTimeoutId = setTimeout(() => {
      if (errorCallback) {
        errorCallback(new Error('连接超时，无法获取工作流事件'));
      }
      isFetching = false;
    }, 30000); // 30秒超时
    
    // 心跳计时器，确保即使没有更新也会定期检查连接状态
    let heartbeatInterval = setInterval(() => {
      // 发送一个"心跳"事件，确保客户端知道连接仍然活跃
      callback({
        type: 'heartbeat',
        data: JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() })
      });
    }, 15000); // 15秒发送一次心跳
    
    // 开始获取数据的函数
    const fetchData = async () => {
      if (!isFetching) return;
      
      try {
        // 确保请求间隔至少为refreshInterval毫秒
        const now = Date.now();
        const timeElapsed = now - lastFetchTime;
        if (timeElapsed < refreshInterval) {
          setTimeout(fetchData, refreshInterval - timeElapsed);
          return;
        }
        
        lastFetchTime = now;
        
        // 发送请求获取工作流列表
        const headers: HeadersInit = {};
        if (this.authToken) {
          headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal
        });
        
        if (!response.ok) {
          throw new Error(`HTTP错误 ${response.status}: ${response.statusText}`);
        }
        
        // 连接成功，清除超时计时器
        if (connectionTimeoutId) {
          clearTimeout(connectionTimeoutId);
          connectionTimeoutId = null;
        }
        
        // 重置错误计数
        errorCount = 0;
        
        const data = await response.json();
        const workflows = data.items || [];
        
        // 检查是否有更新
        let hasUpdates = false;
        
        // 处理每个工作流
        for (const workflow of workflows) {
          const name = workflow.metadata?.name;
          const resourceVersion = workflow.metadata?.resourceVersion;
          
          if (name && resourceVersion) {
            // 如果这是新工作流或版本已更新
            if (!latestResourceVersions[name] || latestResourceVersions[name] !== resourceVersion) {
              hasUpdates = true;
              latestResourceVersions[name] = resourceVersion;
              
              // 模拟事件对象，与EventSource格式兼容
              const event = {
                type: 'message',
                data: JSON.stringify({
                  result: {
                    type: latestResourceVersions[name] ? 'MODIFIED' : 'ADDED',
                    object: workflow
                  }
                })
              };
              
              // 处理工作流中的节点
              if (workflow.status?.nodes) {
                Object.entries(workflow.status.nodes).forEach(([nodeId, node]: [string, any]) => {
                  // 只检查Pod类型且已完成(成功或失败)的节点
                  if ((node.type === 'Pod' || node.type === 'Container') && 
                      (node.phase === 'Succeeded' || node.phase === 'Failed') &&
                      !processedNodes[nodeId]) {
                    
                    processedNodes[nodeId] = true;
                    
                    // 立即触发回调以更新UI
                    callback(event);
                  }
                });
              }
              
              // 触发回调
              callback(event);
            }
          }
        }
        
        // 根据是否有更新来调整刷新间隔
        if (hasUpdates) {
          // 如果有更新，加快刷新速度
          refreshInterval = Math.max(1000, refreshInterval * 0.8);
        } else {
          // 如果没有更新，逐渐放慢刷新速度，但不超过10秒
          refreshInterval = Math.min(10000, refreshInterval * 1.2);
        }
        
        // 继续轮询
        setTimeout(fetchData, refreshInterval);
      } catch (error: any) {
        // 增加错误计数
        errorCount++;
        
        if (errorCallback) {
          errorCallback(error);
        }
        
        // 如果连续错误超过最大次数，停止尝试
        if (errorCount >= MAX_ERRORS) {
          isFetching = false;
          if (errorCallback) {
            errorCallback(new Error(`连续${MAX_ERRORS}次连接失败，请检查网络或服务器状态`));
          }
          return;
        }
        
        // 出错后延迟重试
        if (isFetching) {
          setTimeout(fetchData, refreshInterval * 2);
        }
      }
    };
    
    // 立即开始第一次获取
    fetchData();
    
    // 停止获取的函数
    const stopFetching = () => {
      isFetching = false;
      controller.abort();
      // 清除所有计时器
      if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
      clearInterval(heartbeatInterval);
    };
    
    // 返回一个对象，允许停止获取
    return {
      stop: stopFetching,
      unsubscribe: stopFetching
    };
  }
}

export default ArgoApiClient;
