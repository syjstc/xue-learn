import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAssistant } from "@/components/agent/assistant-provider";

export function GoalCreationPage() {
  const navigate = useNavigate();
  const { openGoalCreationModal } = useAssistant();

  useEffect(() => {
    openGoalCreationModal();
    navigate("/goals", { replace: true });
  }, [navigate, openGoalCreationModal]);

  return null;
}
