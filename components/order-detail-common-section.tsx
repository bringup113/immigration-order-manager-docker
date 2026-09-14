"use client";

import { OrderMaterialsPanel, type Row } from "@/components/order-detail-ui";
import { EmptyState } from "@/components/data-state";
import { TabsContent } from "@/components/ui/tabs";

type Props = {
  canRead: boolean;
  canEdit: boolean;
  canRestore: boolean;
  canDownload: boolean;
  notice: { text: string; error: boolean };
  materials: Row[];
  files: Row[];
  uploadingMaterialId: string;
  onAdd: () => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
  onUpload: (materialId: string, file?: File) => void;
  onReplace: (fileId: string, storedName: string, file?: File) => void;
  onPreview: (file: Row) => void;
  onVoidFile: (fileId: string, storedName: string, version: number) => void;
  onRestoreFile: (fileId: string, storedName: string, version: number) => void;
};

export function OrderDetailCommonSection({
  canRead,
  canEdit,
  canRestore,
  canDownload,
  notice,
  materials,
  files,
  uploadingMaterialId,
  onAdd,
  onEdit,
  onDelete,
  onUpload,
  onReplace,
  onPreview,
  onVoidFile,
  onRestoreFile,
}: Props) {
  return (
    <TabsContent value="common" className="m-0 p-5">
      {canRead ? (
        <OrderMaterialsPanel
          title="合同与付款文件"
          notice={notice}
          materials={materials}
          files={files}
          uploadingMaterialId={uploadingMaterialId}
          canEdit={canEdit}
          canRestore={canRestore}
          canDownload={canDownload}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          onUpload={onUpload}
          onReplace={onReplace}
          onPreview={onPreview}
          onVoidFile={onVoidFile}
          onRestoreFile={onRestoreFile}
        />
      ) : (
        <EmptyState
          title="暂无可查看内容"
          description="当前账号没有材料查看权限。"
        />
      )}
    </TabsContent>
  );
}
