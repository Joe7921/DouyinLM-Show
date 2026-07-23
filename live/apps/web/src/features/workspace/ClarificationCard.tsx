import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { queryKeys } from "../../application/queryKeys";
import { SparklesIcon } from "../../components/Icons";
import type { AsyncWorkspaceResponse } from "../../contracts";
import { useGateway } from "../../data/gatewayContext";

export function ClarificationCard({
  workspaceId,
  question,
  onStarted,
}: {
  workspaceId: string;
  question: string;
  onStarted: (response: AsyncWorkspaceResponse) => void;
}) {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState("");
  const trimmedAnswer = answer.trim();
  const sendAnswer = useMutation({
    mutationFn: () => gateway.sendMessage(workspaceId, { text: trimmedAnswer }),
    onSuccess: (response) => {
      onStarted(response);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collection }),
      ]);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedAnswer || sendAnswer.isPending) return;
    sendAnswer.mutate();
  };

  return (
    <section className="mt-6 rounded-3xl border border-accent/25 bg-accent-soft/55 p-5 shadow-whisper sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-accent shadow-whisper">
          <SparklesIcon className="size-4.5" />
        </span>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-accent uppercase">只确认这一件事</p>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em]">{question}</h2>
          <p className="mt-1 text-xs leading-5 text-muted">回答会改变任务卡密度；本工作区不会继续追问第二次。</p>
        </div>
      </div>
      <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <input
          aria-label="回答关键问题"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none focus:border-accent/50"
          maxLength={300}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="例如：优先快速执行，参数只保留调整规则"
          value={answer}
        />
        <button className="primary-button disabled:cursor-not-allowed disabled:bg-disabled disabled:text-faint disabled:shadow-none" disabled={!trimmedAnswer || sendAnswer.isPending} type="submit">
          {sendAnswer.isPending ? "继续中" : "确认并继续"}
        </button>
      </form>
      {sendAnswer.isError && <p className="mt-2 text-xs text-red-700">回答提交失败：{sendAnswer.error.message}</p>}
    </section>
  );
}
