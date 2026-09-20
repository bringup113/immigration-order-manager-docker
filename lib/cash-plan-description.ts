type PlanDescriptionDraft = {
  orderPlanId: string;
  description: string;
  autoDescription?: string | null;
};

export function selectCashPlan<T extends PlanDescriptionDraft>(
  draft: T,
  planId: string,
  planName: string,
): T {
  if (!planId) return { ...draft, orderPlanId: "", autoDescription: null };
  const canFill = !draft.description.trim() ||
    (draft.autoDescription != null && draft.description === draft.autoDescription);
  const description = planId ? planName : "";
  return {
    ...draft,
    orderPlanId: planId,
    ...(canFill ? { description, autoDescription: planId ? description : null } : {}),
  };
}
