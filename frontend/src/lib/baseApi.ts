import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

interface ErrorResponse {
  error: string;
}

export default class BaseAPI {
  private readonly axios: AxiosInstance;

  constructor(config: AxiosRequestConfig = {}) {
    this.axios = axios.create({
      baseURL: process.env.SERVER_URL,
      headers: { 'Content-Type': 'application/json' },
      ...config
    });
  }

  protected async get<T>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<any> {
    return await this.requestWrapper(
      async () =>
        await this.axios.get<never, AxiosResponse<T | ErrorResponse>>(
          url,
          config
        )
    );
  }

  protected async post<D, T>(
    url: string,
    body: D,
    config?: AxiosRequestConfig
  ): Promise<any> {
    return await this.requestWrapper(
      async () =>
        await this.axios.post<D, AxiosResponse<T | ErrorResponse>>(
          url,
          body,
          config
        )
    );
  }

  protected async put<D, T>(
    url: string,
    body: D,
    config?: AxiosRequestConfig
  ): Promise<any> {
    return await this.requestWrapper(
      async () =>
        await this.axios.put<D, AxiosResponse<T | ErrorResponse>>(
          url,
          body,
          config
        )
    );
  }

  protected async delete<T>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<any> {
    return await this.requestWrapper(
      async () =>
        await this.axios.delete<never, AxiosResponse<T | ErrorResponse>>(
          url,
          config
        )
    );
  }

  private async requestWrapper<T>(
    apiRequest: () => Promise<AxiosResponse<T | ErrorResponse>>
  ): Promise<any> {
    try {
      const response = await apiRequest();

      if (response.status === 200) {
        const data = response.data as T;
        return data;
      }

      if ('error' in response.data) {
        throw new Error(response.data.error);
      }

      throw new Error('Something went wrong!');
    } catch (error: any) {
      if (error.response !== undefined) {
        return await Promise.reject(new Error(error.response.data.error));
      }

      return await Promise.reject(error);
    }
  }
}

// Referenced from https://github.com/CodeToGather/Code2Gather/blob/main/frontend/src/lib/baseApi.ts
