import { readOrderDetail } from "@/lib/order-detail-query";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { mutationTransaction } from "@/lib/api-transaction";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, newId, nowIso } from "@/db/database";
import { DomainError, textValue } from "@/lib/domain";
import {
  deleteStoredFile,
  moveStoredFile,
  type QuarantinedStoredFile,
} from "@/lib/file-storage";
import {
  authorizeApiUser,
  jsonError,
  requireApiUser,
  requireMutationUser,
} from "@/lib/api-auth";
import {
  addOrderPlan,
  deleteOrderPlan,
  moveOrderPlan,
  restoreCashEntry,
  saveCashEntry,
  updateOrderPlan,
  voidCashEntry,
} from "@/lib/order-finance";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { hasPermission } from "@/lib/docker-auth";
import { dateField, FIELD_LIMITS, validateTextFields } from "@/lib/validation";
import {
  addOrderStep,
  changeOrderStatus,
  changeOrderStepStatus,
  deleteOrderStep,
  ensureActiveOrderHasCurrentStep,
  moveOrderStep,
  updateOrderStep,
} from "@/lib/order-workflow";
import type { AppDatabase } from "@/db/driver";
import { orderScopeFilter } from "@/lib/order-access";
import {
  changeOrderTaskStatus,
  deleteOrderTask,
  saveOrderTask,
} from "@/lib/order-tasks";
import { closeOrder, reopenOrder } from "@/lib/order-closure";
import {
  getOrderActionPolicy,
  orderActionAuditCode,
} from "@/lib/order-action-policy";
import { readOrderActionSnapshot } from "@/lib/order-action-audit";
import { deleteOrderMaterial, saveOrderMaterial } from "@/lib/order-materials";
import {
  addDependentApplicant,
  deleteOrderApplicant,
  updateOrderApplicant,
} from "@/lib/order-applicants";
import { confirmApplicantMrz } from "@/lib/order-mrz";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ orderNo: string }> };
type Body = Record<string, unknown>;

function handleError(error: unknown) {
  if (error instanceof DomainError)
    return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("订单保存失败，请稍后重试。", 500);
}

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireApiUser("orders.read");
  if (auth.response) return auth.response;
  const { orderNo } = await context.params;
  return readOrderDetail(auth.user, orderNo, request.nextUrl.searchParams);
}

async function handlePost(
  context: Context,
  body: Body,
  user: ChatGPTUser,
  rootDb: AppDatabase = getDatabase(),
  quarantinedFiles: QuarantinedStoredFile[] = [],
) {
  const auth = authorizeApiUser(user, "orders.read");
  if (auth.response) return auth.response;
  const { orderNo } = await context.params;
  try {
    validateTextFields(body, [
      { key: "action", label: "操作类型", max: 64, required: true },
      { key: "title", label: "跟进内容", max: FIELD_LIMITS.name },
      { key: "details", label: "跟进详情", max: FIELD_LIMITS.progressDetails },
      { key: "nextAction", label: "下一步事项", max: FIELD_LIMITS.name },
      { key: "reason", label: "操作原因", max: FIELD_LIMITS.description },
      { key: "name", label: "名称", max: FIELD_LIMITS.name },
      { key: "nationality", label: "国籍", max: FIELD_LIMITS.country },
      { key: "passportNo", label: "护照号码", max: FIELD_LIMITS.passport },
      { key: "relationship", label: "关系", max: FIELD_LIMITS.shortName },
      { key: "surname", label: "护照姓", max: FIELD_LIMITS.name },
      { key: "givenNames", label: "护照名", max: FIELD_LIMITS.name },
      {
        key: "issuingCountry",
        label: "签发国家或地区",
        max: FIELD_LIMITS.country,
      },
      { key: "documentCode", label: "证件类型", max: FIELD_LIMITS.code },
      { key: "personalNumber", label: "个人号码", max: FIELD_LIMITS.passport },
      { key: "notes", label: "备注", max: FIELD_LIMITS.notes },
      { key: "closureResult", label: "结案结果", max: FIELD_LIMITS.name },
      { key: "closureNotes", label: "结案备注", max: FIELD_LIMITS.notes },
    ]);
  } catch (error) {
    return handleError(error);
  }
  const action = textValue(body, "action");
  const policy = getOrderActionPolicy(action);
  const mutationAuth = authorizeApiUser(user, policy.permission);
  if (mutationAuth.response) return mutationAuth.response;
  try {
    const response = await rootDb.transaction(async (db) => {
      const scope = orderScopeFilter(mutationAuth.user!, "o");
      const order = await db
        .prepare(
          `SELECT o.id,o.order_no,o.owner_user_id,o.version FROM orders o WHERE o.order_no=? AND ${scope.sql} FOR UPDATE`,
        )
        .bind(orderNo, ...scope.values)
        .first();
      if (!order) return jsonError("订单不存在。", 404);
      const expectedVersion = Number(body.expectedVersion);
      if (
        Number.isFinite(expectedVersion) &&
        expectedVersion !== Number(order.version)
      ) {
        return jsonError(
          "此订单刚刚被其他用户修改，页面已刷新为最新内容，请确认后重试。",
          409,
        );
      }
      const id = String(order.id);
      const now = nowIso();
      if (action === "assignOwner") {
        const ownerUserId = textValue(body, "ownerUserId");
        const owner = ownerUserId
          ? await db
              .prepare("SELECT id FROM users WHERE id=? AND active=1")
              .bind(ownerUserId)
              .first()
          : null;
        if (!owner) throw new DomainError("订单负责人不存在或已停用。", 404);
        await db
          .prepare(
            "UPDATE orders SET owner_user_id=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(ownerUserId, now, id)
          .run();
        return NextResponse.json({ ok: true });
      }
      if (action === "saveTask") {
        const taskId = await saveOrderTask(
          db,
          id,
          body,
          String(order.owner_user_id),
        );
        await db
          .prepare(
            "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(now, id)
          .run();
        return NextResponse.json(
          { id: taskId },
          { status: textValue(body, "taskId") ? 200 : 201 },
        );
      }
      if (action === "toggleTask") {
        await changeOrderTaskStatus(
          db,
          id,
          textValue(body, "taskId"),
          textValue(body, "status"),
        );
        await db
          .prepare(
            "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(now, id)
          .run();
        return NextResponse.json({ ok: true });
      }
      if (action === "deleteTask") {
        await deleteOrderTask(db, id, textValue(body, "taskId"));
        await db
          .prepare(
            "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(now, id)
          .run();
        return NextResponse.json({ ok: true });
      }
      if (action === "progress") {
        const title = textValue(body, "title");
        const nextAction = textValue(body, "nextAction");
        const followUpDate = dateField(body, "followUpDate", "跟进日期") || "";
        const progressDate =
          dateField(body, "progressDate", "记录日期") || now.slice(0, 10);
        if (!title) throw new DomainError("请填写本次跟进内容。");
        if (Boolean(nextAction) !== Boolean(followUpDate))
          throw new DomainError("下一步事项和跟进日期需要同时填写。");
        await db.batch([
          ...(followUpDate
            ? [
                db
                  .prepare(
                    "UPDATE order_progress SET follow_up_done=1 WHERE order_id=? AND follow_up_done=0 AND follow_up_date IS NOT NULL",
                  )
                  .bind(id),
              ]
            : []),
          db
            .prepare(
              "INSERT INTO order_progress (id,order_id,progress_date,title,details,next_action,follow_up_date,follow_up_done,pinned,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              newId("pro"),
              id,
              progressDate,
              title,
              textValue(body, "details") || null,
              nextAction || null,
              followUpDate || null,
              followUpDate ? 0 : 1,
              body.pinned === true ? 1 : 0,
              now,
            ),
          db
            .prepare(
              "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
            )
            .bind(now, id),
        ]);
        return NextResponse.json({ ok: true });
      }
      if (action === "completeFollowUp") {
        const progressId = textValue(body, "progressId");
        const existing = progressId
          ? await db
              .prepare(
                "SELECT id FROM order_progress WHERE id=? AND order_id=? AND follow_up_date IS NOT NULL",
              )
              .bind(progressId, id)
              .first()
          : null;
        if (!existing) throw new DomainError("待跟进记录不存在。", 404);
        await db.batch([
          db
            .prepare(
              "UPDATE order_progress SET follow_up_done=1 WHERE id=? AND order_id=?",
            )
            .bind(progressId, id),
          db
            .prepare(
              "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
            )
            .bind(now, id),
        ]);
        return NextResponse.json({ ok: true });
      }
      if (action === "status") {
        const status = textValue(body, "status");
        await changeOrderStatus(db, id, status, {
          reason: textValue(body, "reason"),
          canOverride: hasPermission(mutationAuth.user!, "orders.override"),
        });
        return NextResponse.json({ ok: true });
      }
      if (action === "closeOrder") {
        const closedOn = dateField(body, "closedOn", "结案日期", true)!;
        const check = await closeOrder(db, id, {
          closedOn,
          result: textValue(body, "closureResult"),
          notes: textValue(body, "closureNotes"),
          reason: textValue(body, "reason"),
          actorUserId: mutationAuth.user!.id,
          canOverride: hasPermission(mutationAuth.user!, "orders.override"),
        });
        return NextResponse.json({ ok: true, check });
      }
      if (action === "reopenOrder") {
        await reopenOrder(
          db,
          id,
          textValue(body, "reason"),
          mutationAuth.user!.id,
        );
        await ensureActiveOrderHasCurrentStep(db, id);
        return NextResponse.json({ ok: true });
      }
      if (action === "updateNotes") {
        await db
          .prepare(
            "UPDATE orders SET notes=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(textValue(body, "notes") || null, now, id)
          .run();
        return NextResponse.json({ ok: true });
      }
      if (action === "updateSignedAt") {
        const signedAt = dateField(body, "signedAt", "签订日期", true)!;
        await db
          .prepare(
            "UPDATE orders SET signed_at=?,version=version+1,updated_at=? WHERE id=?",
          )
          .bind(signedAt, now, id)
          .run();
        return NextResponse.json({ ok: true });
      }
      if (action === "updateApplicant") {
        await updateOrderApplicant(
          db,
          { id, orderNo: String(order.order_no) },
          body,
          mutationAuth.user!.id,
        );
        return NextResponse.json({ ok: true });
      }
      if (action === "addApplicant") {
        const created = await addDependentApplicant(db, id, body);
        return NextResponse.json(
          {
            id: created.applicantId,
            passportMaterialId: created.passportMaterialId,
          },
          { status: 201 },
        );
      }
      if (action === "confirmMrz") {
        const confirmed = await confirmApplicantMrz(
          db,
          id,
          body,
          mutationAuth.user!.id,
        );
        return NextResponse.json({ ok: true, ...confirmed });
      }
      if (action === "deleteApplicant") {
        await deleteOrderApplicant(db, id, body, quarantinedFiles);
        return NextResponse.json({ ok: true });
      }
      if (action === "step") {
        const stepId = textValue(body, "stepId");
        const status = textValue(body, "status");
        await changeOrderStepStatus(db, id, stepId, status, {
          reason: textValue(body, "reason"),
          canOverride: hasPermission(mutationAuth.user!, "orders.override"),
        });
        return NextResponse.json({ ok: true });
      }
      if (action === "addStep") {
        await addOrderStep(db, id, body);
        return NextResponse.json({ ok: true });
      }
      if (action === "updateStep") {
        await updateOrderStep(db, id, body);
        return NextResponse.json({ ok: true });
      }
      if (action === "deleteStep") {
        const stepId = textValue(body, "stepId");
        await deleteOrderStep(db, id, stepId);
        return NextResponse.json({ ok: true });
      }
      if (action === "moveStep") {
        const stepId = textValue(body, "stepId");
        const direction = textValue(body, "direction");
        await moveOrderStep(db, id, stepId, direction);
        return NextResponse.json({ ok: true });
      }
      if (action === "addMaterial" || action === "updateMaterial") {
        await saveOrderMaterial(
          db,
          { id, orderNo: String(order.order_no) },
          body,
        );
        return NextResponse.json({ ok: true });
      }
      if (action === "deleteMaterial") {
        await deleteOrderMaterial(db, id, body, quarantinedFiles);
        return NextResponse.json({ ok: true });
      }
      if (action === "plan") {
        await addOrderPlan(id, body, db);
        await db
          .prepare(
            "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
          )
          .bind(now, id)
          .run();
        return NextResponse.json({ ok: true });
      }
      if (action === "updatePlan") {
        await updateOrderPlan(id, body, db);
        return NextResponse.json({ ok: true });
      }
      if (action === "deletePlan") {
        await deleteOrderPlan(id, textValue(body, "planId"), db);
        return NextResponse.json({ ok: true });
      }
      if (action === "movePlan") {
        await moveOrderPlan(
          id,
          textValue(body, "planId"),
          textValue(body, "direction"),
          db,
        );
        return NextResponse.json({ ok: true });
      }
      if (action === "saveCashEntry") {
        return NextResponse.json(
          { id: await saveCashEntry(id, body, db) },
          { status: textValue(body, "entryId") ? 200 : 201 },
        );
      }
      if (action === "voidCashEntry") {
        await voidCashEntry(
          id,
          textValue(body, "entryId"),
          textValue(body, "reason"),
          mutationAuth.user!.id,
          db,
        );
        return NextResponse.json({ ok: true });
      }
      if (action === "restoreCashEntry") {
        await restoreCashEntry(
          id,
          textValue(body, "entryId"),
          textValue(body, "reason"),
          db,
        );
        return NextResponse.json({ ok: true });
      }
      throw new DomainError("不支持该操作。");
    });
    return response;
  } catch (error) {
    for (const file of quarantinedFiles.reverse())
      await moveStoredFile(file.quarantinePath, file.originalPath).catch(
        () => undefined,
      );
    return handleError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const { orderNo } = await context.params;
  const auth = await requireMutationUser(request);
  if (auth.response) return auth.response;
  const quarantinedFiles: QuarantinedStoredFile[] = [];
  const action = textValue(body, "action") || "update";
  const policy = getOrderActionPolicy(action);
  const auditBody = policy.redactRawMrz
    ? { ...body, rawMrz: "[已隐藏]" }
    : body;
  const taskAction = policy.entityType === "TASK";
  const cashAction = policy.entityType === "CASH_ENTRY";
  const actionCode = orderActionAuditCode(action, {
    taskId: textValue(body, "taskId"),
    taskStatus: textValue(body, "status"),
  });
  const actionText = policy.label;
  try {
    const response = await mutationTransaction(async (db) => {
      const before = auth.user
        ? await readOrderActionSnapshot(db, orderNo, body, auth.user)
        : null;
      const result = await handlePost(
        context,
        body,
        auth.user,
        db,
        quarantinedFiles,
      );
      if (!result.ok || !auth.user) return result;
      const after = await readOrderActionSnapshot(
        db,
        orderNo,
        body,
        auth.user,
        false,
      );
      const resultBody =
        taskAction || cashAction
          ? ((await result
              .clone()
              .json()
              .catch(() => ({}))) as Record<string, unknown>)
          : {};
      const entityId = policy.entityIdField
        ? textValue(body, policy.entityIdField) ||
          String(resultBody.id || "") ||
          orderNo
        : orderNo;
      const entityType = policy.entityType || "ORDER";
      const entityLabel = policy.entityLabelField
        ? textValue(body, policy.entityLabelField) ||
          String(before?.target?.description || orderNo)
        : orderNo;
      await writeAudit(
        request,
        auth.user,
        {
          action: actionCode,
          entityType,
          entityId,
          entityLabel,
          summary: actionText,
          changes: { before, after, submitted: auditBody },
        },
        db,
      );
      return result;
    });
    if (response.ok)
      for (const file of quarantinedFiles)
        await deleteStoredFile(file.quarantinePath).catch(console.error);
    else
      for (const file of quarantinedFiles.reverse())
        await moveStoredFile(file.quarantinePath, file.originalPath).catch(
          () => undefined,
        );
    if (!response.ok && auth.user)
      await writeAuditBestEffort(request, auth.user, {
        action: actionCode,
        entityType: policy.entityType || "ORDER",
        entityId: policy.entityIdField
          ? textValue(body, policy.entityIdField) || orderNo
          : orderNo,
        entityLabel: orderNo,
        result: "FAILURE",
        summary: `尝试${actionText}`,
        changes: { submitted: auditBody },
      });
    return response;
  } catch (error) {
    for (const file of quarantinedFiles.reverse())
      await moveStoredFile(file.quarantinePath, file.originalPath).catch(
        () => undefined,
      );
    if (auth.user)
      await writeAuditBestEffort(request, auth.user, {
        action: actionCode,
        entityType: policy.entityType || "ORDER",
        entityId: policy.entityIdField
          ? textValue(body, policy.entityIdField) || orderNo
          : orderNo,
        entityLabel: orderNo,
        result: "FAILURE",
        summary: `尝试${actionText}`,
        changes: { submitted: auditBody },
      });
    return handleError(error);
  }
}
