/**
 * 后端 API 客户端（基于 axios）
 *
 * 后端统一响应：{ code: number, message: string, data: T }
 * - 请求拦截器：注入 JWT token（后续接入）
 * - 响应拦截器：检查业务返回码，自动解包 data 字段
 */

import axios from "axios";
import type { AxiosError, AxiosResponse } from "axios";

const BASE_URL = "/api";

export const http = axios.create({
  baseURL: BASE_URL,
  // 解析 PDF 含 Unstructured 云 + 图片语义化，单次接口实测可到 30s+；
  // 5 分钟兜底覆盖多页/大文件慢解析，避免 axios 先于后端返回超时。
  timeout: 300_000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.response.use(
  (response: AxiosResponse<{ code: number; message: string; data: unknown }>) => {
    const { code, message, data } = response.data;

    // 非 200 视为业务异常
    if (code !== undefined && code !== 200) {
      return Promise.reject(new Error(message || "请求失败"));
    }

    // 解包 data，替换 response.data 供调用方直接使用
    response.data = data as AxiosResponse["data"];
    return response;
  },
  (error: AxiosError<{ code?: number; message?: string }>) => {
    if (error.response?.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("rag:unauthorized"));
    const msg = error.response?.data?.message || error.message || "网络错误";
    return Promise.reject(new Error(msg));
  },
);

export async function get<T>(url: string, params?: Record<string, string>): Promise<T> {
  const res = await http.get<T>(url, { params });
  return res.data;
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.post<T>(url, body);
  return res.data;
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.patch<T>(url, body);
  return res.data;
}

export async function del<T>(url: string): Promise<T> {
  const res = await http.delete<T>(url);
  return res.data;
}
