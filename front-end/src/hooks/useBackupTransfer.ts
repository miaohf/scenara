import React, { useRef, useState } from 'react';
import { importIndexedDBData } from '../services/storageService';

type AlertType = 'info' | 'success' | 'error' | 'warning';

type ShowAlert = (
  message: string,
  options?: {
    type?: AlertType;
    onConfirm?: () => void;
    showCancel?: boolean;
  }
) => void;

export type ImportResult = { projects: number; assets: number };

export interface BackupTransferMessages {
  invalidFileType?: string;
  exportSuccess?: string;
  exportError?: (error: unknown) => string;
  importConfirm?: (projectCount: number, assetCount: number) => string;
  importSuccess?: (result: ImportResult) => string;
  importError?: (error: unknown) => string;
}

interface UseBackupTransferOptions<TPayload = unknown> {
  exporter: () => Promise<TPayload>;
  exportFileName: (timestamp: string) => string;
  showAlert: ShowAlert;
  onImportSuccess?: (result: ImportResult) => Promise<void> | void;
  messages?: BackupTransferMessages;
}

type ResolvedBackupTransferMessages = Required<BackupTransferMessages>;

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : '未知错误');

export const DEFAULT_BACKUP_TRANSFER_MESSAGES: ResolvedBackupTransferMessages = {
  invalidFileType: '请选择 .json 备份文件。',
  exportSuccess: '导出完成，备份文件已下载。',
  exportError: (error) => `导出失败: ${getErrorMessage(error)}`,
  importConfirm: (projectCount, assetCount) =>
    `将导入 ${projectCount} 个项目和 ${assetCount} 个资产。若 ID 冲突将覆盖现有数据。是否继续？`,
  importSuccess: (result) => `导入完成：项目 ${result.projects} 个，资产 ${result.assets} 个。`,
  importError: (error) => `导入失败: ${getErrorMessage(error)}`,
};

export const PROJECT_BACKUP_TRANSFER_MESSAGES: BackupTransferMessages = {
  exportSuccess: '当前项目已导出，备份文件已下载。',
};

export const EPISODE_BACKUP_TRANSFER_MESSAGES: BackupTransferMessages = {
  exportSuccess: '当前剧集已导出，备份文件已下载。',
};

export const globalBackupFileName = (timestamp: string) => `bigbanana_backup_${timestamp}.json`;

export const projectBackupFileName = (projectId: string, timestamp: string) =>
  `bigbanana_project_${projectId}_${timestamp}.json`;

export const episodeBackupFileName = (episodeId: string, timestamp: string) =>
  `bigbanana_episode_${episodeId}_${timestamp}.json`;

const resolveMessages = (messages?: BackupTransferMessages): ResolvedBackupTransferMessages => ({
  ...DEFAULT_BACKUP_TRANSFER_MESSAGES,
  ...messages,
});

export function useBackupTransfer<TPayload = unknown>({
  exporter,
  exportFileName,
  showAlert,
  onImportSuccess,
  messages,
}: UseBackupTransferOptions<TPayload>) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isDataExporting, setIsDataExporting] = useState(false);
  const [isDataImporting, setIsDataImporting] = useState(false);
  const resolvedMessages = resolveMessages(messages);

  const handleExportData = async () => {
    if (isDataExporting) return;

    setIsDataExporting(true);
    try {
      const payload = await exporter();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(timestamp);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showAlert(resolvedMessages.exportSuccess, { type: 'success' });
    } catch (error) {
      console.error('Export failed:', error);
      showAlert(resolvedMessages.exportError(error), { type: 'error' });
    } finally {
      setIsDataExporting(false);
    }
  };

  const handleImportData = () => {
    if (isDataImporting) return;
    importInputRef.current?.click();
  };

  const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      showAlert(resolvedMessages.invalidFileType, { type: 'warning' });
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const projectCount = payload?.stores?.seriesProjects?.length || payload?.stores?.projects?.length || 0;
      const assetCount = payload?.stores?.assetLibrary?.length || 0;
      const confirmMessage = resolvedMessages.importConfirm(projectCount, assetCount);

      showAlert(confirmMessage, {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          try {
            setIsDataImporting(true);
            const result = await importIndexedDBData(payload, { mode: 'merge' });
            await onImportSuccess?.(result);
            showAlert(resolvedMessages.importSuccess(result), { type: 'success' });
          } catch (error) {
            console.error('Import failed:', error);
            showAlert(resolvedMessages.importError(error), { type: 'error' });
          } finally {
            setIsDataImporting(false);
          }
        },
      });
    } catch (error) {
      console.error('Import failed:', error);
      showAlert(resolvedMessages.importError(error), { type: 'error' });
    }
  };

  return {
    importInputRef,
    isDataExporting,
    isDataImporting,
    handleExportData,
    handleImportData,
    handleImportFileChange,
  };
}
