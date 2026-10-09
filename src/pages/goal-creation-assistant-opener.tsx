"use client";

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAssistant } from "@/components/agent/assistant-provider";

export function GoalCreationAssistantOpener() {
  const { openGoalCreationPrompt } = useAssistant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const topic = searchParams.get("topic")?.trim() || undefined;

  useEffect(() => {
    openGoalCreationPrompt(topic);
    navigate("/goals", { replace: true });
  }, [navigate, openGoalCreationPrompt, topic]);

  return null;
}
