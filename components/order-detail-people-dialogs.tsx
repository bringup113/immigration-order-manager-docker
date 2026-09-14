import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Choose, Field, type Row } from "@/components/order-detail-ui";
import type {
  ApplicantDraft,
  MaterialDraft,
  MrzReview,
} from "@/components/order-detail-types";
import { describeMrzChecksum, type PassportIdentity } from "@/lib/passport-mrz";

type PassportIdentityFieldsProps = {
  value: PassportIdentity;
  onChange: (value: PassportIdentity) => void;
  required?: boolean;
};

function PassportIdentityFields({
  value,
  onChange,
  required = false,
}: PassportIdentityFieldsProps) {
  const update = <Key extends keyof PassportIdentity>(
    key: Key,
    fieldValue: PassportIdentity[Key],
  ) => onChange({ ...value, [key]: fieldValue });

  return (
    <>
      <Field label="系统显示姓名">
        <Input
          required={required}
          className="mt-2"
          value={value.name}
          onChange={(event) => update("name", event.target.value)}
        />
      </Field>
      <Field label="护照姓">
        <Input
          className="mt-2 uppercase"
          value={value.surname}
          onChange={(event) =>
            update("surname", event.target.value.toUpperCase())
          }
        />
      </Field>
      <Field label="护照名">
        <Input
          className="mt-2 uppercase"
          value={value.givenNames}
          onChange={(event) =>
            update("givenNames", event.target.value.toUpperCase())
          }
        />
      </Field>
      <Field label="护照号码">
        <Input
          required={required}
          className="mt-2 uppercase"
          value={value.passportNo}
          onChange={(event) =>
            update("passportNo", event.target.value.toUpperCase())
          }
        />
      </Field>
      <Field label="国籍">
        <Input
          required={required}
          className="mt-2 uppercase"
          value={value.nationality}
          onChange={(event) =>
            update("nationality", event.target.value.toUpperCase())
          }
        />
      </Field>
      <Field label="出生日期">
        <Input
          required={required}
          type="date"
          className="mt-2"
          value={value.birthDate}
          onChange={(event) => update("birthDate", event.target.value)}
        />
      </Field>
      <Field label="性别">
        <Choose
          value={value.sex || "UNKNOWN"}
          onChange={(sex) =>
            update(
              "sex",
              sex === "UNKNOWN" ? "" : (sex as PassportIdentity["sex"]),
            )
          }
          items={[
            ["UNKNOWN", "未填写"],
            ["M", "男"],
            ["F", "女"],
            ["X", "未指定"],
          ]}
        />
      </Field>
      <Field label="护照有效期">
        <Input
          required={required}
          type="date"
          className="mt-2"
          value={value.passportExpiry}
          onChange={(event) => update("passportExpiry", event.target.value)}
        />
      </Field>
      <Field label="签发国家/地区">
        <Input
          className="mt-2 uppercase"
          value={value.issuingCountry}
          onChange={(event) =>
            update("issuingCountry", event.target.value.toUpperCase())
          }
        />
      </Field>
      <Field label="证件类型">
        <Input
          className="mt-2 uppercase"
          value={value.documentCode}
          onChange={(event) =>
            update("documentCode", event.target.value.toUpperCase())
          }
        />
      </Field>
      <Field label="个人号码/可选数据">
        <Input
          className="mt-2 uppercase"
          value={value.personalNumber}
          onChange={(event) =>
            update("personalNumber", event.target.value.toUpperCase())
          }
        />
      </Field>
    </>
  );
}

type OrderDetailPeopleDialogsProps = {
  activeDialog: string | null;
  applicants: Row[];
  editingMaterialId: string;
  material: MaterialDraft;
  onMaterialChange: (value: MaterialDraft) => void;
  onCloseMaterial: () => void;
  onSaveMaterial: () => Promise<void>;
  editingApplicantId: string;
  applicant: ApplicantDraft;
  onApplicantChange: (value: ApplicantDraft) => void;
  onCloseApplicant: () => void;
  onSaveApplicant: () => Promise<void>;
  mrzReview: MrzReview | null;
  onMrzReviewChange: (value: MrzReview | null) => void;
  onCloseMrz: () => void;
  onConfirmMrz: () => Promise<void>;
  message: string;
};

export function OrderDetailPeopleDialogs({
  activeDialog,
  applicants,
  editingMaterialId,
  material,
  onMaterialChange,
  onCloseMaterial,
  onSaveMaterial,
  editingApplicantId,
  applicant,
  onApplicantChange,
  onCloseApplicant,
  onSaveApplicant,
  mrzReview,
  onMrzReviewChange,
  onCloseMrz,
  onConfirmMrz,
  message,
}: OrderDetailPeopleDialogsProps) {
  const editingApplicant = applicants.find(
    (row) => row.id === editingApplicantId,
  );

  return (
    <>
      <Dialog
        open={activeDialog === "material"}
        onOpenChange={(open) => !open && onCloseMaterial()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMaterialId ? "修改材料要求" : "增加材料要求"}
            </DialogTitle>
            <DialogDescription>
              材料归属可以选择具体申请人，也可以移入“合同与付款”。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="材料名称">
              <Input
                className="mt-2"
                value={material.name}
                onChange={(event) =>
                  onMaterialChange({ ...material, name: event.target.value })
                }
              />
            </Field>
            <Field label="材料归属">
              <Choose
                value={material.applicantId || "COMMON"}
                onChange={(value) =>
                  onMaterialChange({
                    ...material,
                    applicantId: value === "COMMON" ? "" : value,
                  })
                }
                items={[
                  ["COMMON", "合同与付款"],
                  ...applicants.map((row) => [
                    String(row.id),
                    String(row.name),
                  ]),
                ]}
              />
            </Field>
            <Field label="预计日期">
              <Input
                className="mt-2"
                type="date"
                value={material.expectedDate}
                onChange={(event) =>
                  onMaterialChange({
                    ...material,
                    expectedDate: event.target.value,
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox
                checked={material.required}
                onCheckedChange={(checked) =>
                  onMaterialChange({
                    ...material,
                    required: Boolean(checked),
                  })
                }
              />{" "}
              必需材料
            </label>
            <div className="sm:col-span-2">
              <Field label="备注">
                <Textarea
                  className="mt-2"
                  value={material.notes}
                  onChange={(event) =>
                    onMaterialChange({
                      ...material,
                      notes: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseMaterial}>
              取消
            </Button>
            <Button
              disabled={!material.name.trim()}
              onClick={() => void onSaveMaterial()}
              className="bg-[#0f766e]"
            >
              {editingMaterialId ? "保存修改" : "增加材料"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeDialog === "applicant"}
        onOpenChange={(open) => !open && onCloseApplicant()}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingApplicantId ? "修改申请人资料" : "添加附属申请人"}
            </DialogTitle>
            <DialogDescription>
              护照首页是每位申请人的系统固定材料；新增申请人后会自动建立。姓名、护照号码、国籍、出生日期和有效期为必填。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PassportIdentityFields
              required
              value={applicant}
              onChange={(value) =>
                onApplicantChange({
                  ...value,
                  relationship: applicant.relationship,
                })
              }
            />
            {!editingApplicantId ||
            editingApplicant?.applicant_type === "DEPENDENT" ? (
              <Field label="与主申请人关系">
                <Choose
                  value={applicant.relationship || "其他"}
                  onChange={(relationship) =>
                    onApplicantChange({ ...applicant, relationship })
                  }
                  items={[
                    ["配偶", "配偶"],
                    ["子女", "子女"],
                    ["父母", "父母"],
                    ["其他", "其他"],
                  ]}
                />
              </Field>
            ) : (
              <div />
            )}
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseApplicant}>
              取消
            </Button>
            <Button
              disabled={
                !applicant.name.trim() ||
                !applicant.passportNo.trim() ||
                !applicant.nationality.trim() ||
                !applicant.birthDate ||
                !applicant.passportExpiry
              }
              onClick={() => void onSaveApplicant()}
              className="bg-[#0f766e]"
            >
              {editingApplicantId ? "保存申请人" : "添加申请人"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeDialog === "mrz"}
        onOpenChange={(open) => !open && onCloseMrz()}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>确认护照 MRZ 识别结果</DialogTitle>
            <DialogDescription>
              请对照护照首页核对。系统显示姓名为空时自动采用护照英文姓名；确认后保存完整
              MRZ 和校验结果。
            </DialogDescription>
          </DialogHeader>
          {mrzReview && (
            <>
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${mrzReview.capture.valid ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
              >
                {mrzReview.capture.valid ? (
                  <ShieldCheck size={17} />
                ) : (
                  <AlertTriangle size={17} />
                )}
                <span>
                  {mrzReview.capture.valid
                    ? "全部校验位通过"
                    : "存在未通过的校验位，仍可在人工核对后确认"}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <PassportIdentityFields
                  value={mrzReview.fields}
                  onChange={(fields) =>
                    onMrzReviewChange({ ...mrzReview, fields })
                  }
                />
              </div>
              <details className="rounded-xl border p-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium">
                  查看原始 MRZ 与校验结果
                </summary>
                {mrzReview.capture.formatWarning && (
                  <p className="mt-3 text-amber-700">
                    {mrzReview.capture.formatWarning}
                  </p>
                )}
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-slate-100">
                  {mrzReview.capture.rawMrz}
                </pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(mrzReview.capture.checksums).map(
                    ([key, valid]) => (
                      <Badge
                        key={key}
                        variant="outline"
                        className={
                          valid
                            ? "border-emerald-200 text-emerald-700"
                            : "border-rose-200 text-rose-700"
                        }
                      >
                        {describeMrzChecksum(key)}：{valid ? "通过" : "未通过"}
                      </Badge>
                    ),
                  )}
                </div>
              </details>
            </>
          )}
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseMrz}>
              取消
            </Button>
            <Button
              disabled={
                !mrzReview?.fields.name.trim() ||
                !mrzReview?.fields.passportNo.trim() ||
                !mrzReview?.fields.nationality.trim() ||
                !mrzReview?.fields.birthDate ||
                !mrzReview?.fields.passportExpiry
              }
              onClick={() => void onConfirmMrz()}
              className="bg-[#0f766e]"
            >
              确认并登记
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
