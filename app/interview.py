from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.models import InterviewPhase


INTRO_PROMPT = """
You are Lucy, an AI interviewer conducting a structured interview.
Rules:
- Follow the interview phases strictly and do not skip ahead.
- Start with: "Hey {name}," if a candidate name can be inferred from CV context; otherwise use "Hey there,".
- Introduce yourself: "My name is Lucy, your AI interviewer."
- Confirm the role the candidate applied for.
- Ask naturally: "How is your day going?"
- Keep tone warm, concise, and professional.
- Do not invent CV details that are absent from provided context.
"""


QNA_PROMPT = """
You are Lucy, an AI interviewer conducting a staged interview.
Rules:
- Ask exactly one question in each response.
- Follow the stage and question-number instruction from the user prompt.
- Increase difficulty progressively as question number increases.
- Use retrieved CV context for project-grounded questioning whenever possible.
- For domain fundamentals, ask role-relevant general questions (examples: webhooks, embeddings, API design, architecture).
- Keep each question short (1-2 sentences), clear, and professional.
- Do not provide a final score in this phase.
"""

FINAL_SCORE_PROMPT = """
You are Lucy, an AI interviewer finishing an interview.
Rules:
- Provide final score out of 100 as an integer.
- Start exactly with: "Interview complete. Final score: X/100."
- Then include four short sections:
  1) Strengths
  2) Improvement Areas
  3) Difficulty Progression Feedback
  4) Final Recommendation
- Use evidence from interview history and CV summary.
- Do not ask any more questions.
"""


@dataclass
class SessionState:
    session_id: UUID
    role_name: str
    cv_summary: str
    phase: InterviewPhase = InterviewPhase.INTRODUCTION
    history: list[dict[str, str]] = field(default_factory=list)
    max_questions: int = 15


class InterviewManager:
    def __init__(self) -> None:
        self._sessions: dict[UUID, SessionState] = {}

    def start_session(self, session_id: UUID, role_name: str, cv_summary: str) -> SessionState:
        state = SessionState(session_id=session_id, role_name=role_name, cv_summary=cv_summary)
        self._sessions[session_id] = state
        return state

    def get_session(self, session_id: UUID) -> SessionState:
        try:
            return self._sessions[session_id]
        except KeyError as exc:
            raise KeyError("Unknown session. Upload a CV before starting chat.") from exc

    def append_turn(self, session_id: UUID, role: str, content: str) -> None:
        state = self.get_session(session_id)
        state.history.append({"role": role, "content": content})

    def complete_introduction(self, session_id: UUID) -> None:
        state = self.get_session(session_id)
        state.phase = InterviewPhase.QNA

    def build_intro_messages(self, session_id: UUID) -> list[dict[str, str]]:
        state = self.get_session(session_id)
        user_prompt = (
            f"The candidate is applying for the role: {state.role_name}.\n"
            f"Summarized CV details:\n{state.cv_summary}\n\n"
            "Start the interview with Lucy's introduction and day-check opener."
        )
        return [{"role": "user", "content": user_prompt}]

    def candidate_answer_count(self, session_id: UUID) -> int:
        state = self.get_session(session_id)
        return sum(1 for turn in state.history if turn["role"] == "user")

    def should_finalize(self, session_id: UUID) -> bool:
        state = self.get_session(session_id)
        return self.candidate_answer_count(session_id) >= state.max_questions

    def get_stage_instruction(self, next_question_number: int) -> str:
        if next_question_number <= 2:
            return (
                "Stage 1/3 (Generic motivation): ask questions like why this role and favorite part of this role."
            )
        if next_question_number <= 10:
            if next_question_number <= 6:
                return (
                    "Stage 2/3A (Project-based): ask CV-grounded project questions with increasing depth."
                )
            return (
                "Stage 2/3B (General field): ask domain fundamentals and core concepts with increasing difficulty."
            )
        return (
            "Stage 3/3 (Situational): ask scenario-based questions with increasing complexity and trade-offs."
        )

    def infer_level(self, role_name: str) -> str:
        normalized = role_name.strip().lower()
        if normalized.startswith("intern"):
            return "intern"
        if normalized.startswith("junior"):
            return "junior"
        if normalized.startswith("mid"):
            return "mid"
        if normalized.startswith("senior"):
            return "senior"
        return "mid"

    def level_difficulty_instruction(self, level: str, question_number: int) -> str:
        if level == "intern":
            return (
                "Level target: Intern. Keep questions simple and practical; avoid deep architecture and advanced edge cases."
            )
        if level == "junior":
            return (
                "Level target: Junior. Use foundational-to-intermediate questions with moderate follow-up depth."
            )
        if level == "senior":
            return (
                "Level target: Senior. Ask hard questions involving system design, trade-offs, leadership, and ambiguity."
            )
        # mid default
        if question_number <= 5:
            return "Level target: Mid. Start at moderate complexity with practical implementation details."
        return "Level target: Mid. Move toward complex debugging, design trade-offs, and decision rationale."

    def build_qna_messages(
        self,
        session_id: UUID,
        candidate_message: str,
        retrieved_context: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        state = self.get_session(session_id)
        asked_count = self.candidate_answer_count(session_id)
        next_question_number = asked_count + 1
        inferred_level = self.infer_level(state.role_name)
        context_lines = []
        for item in retrieved_context:
            similarity = round(float(item.get("similarity", 0.0)), 3)
            context_lines.append(
                f"- similarity={similarity} | source={item['source_filename']} | text={item['chunk_text']}"
            )

        prompt = (
            f"Role applied for: {state.role_name}\n"
            f"CV summary:\n{state.cv_summary}\n\n"
            f"Interview flow constraints:\n"
            f"- Ask question #{next_question_number} of {state.max_questions}\n"
            f"- Difficulty should match level {next_question_number}/15\n"
            f"- {self.get_stage_instruction(next_question_number)}\n\n"
            f"{self.level_difficulty_instruction(inferred_level, next_question_number)}\n\n"
            f"Retrieved CV context:\n{chr(10).join(context_lines)}\n\n"
            f"Candidate's latest reply:\n{candidate_message}"
        )
        return [*state.history, {"role": "user", "content": prompt}]

    def build_final_score_messages(
        self,
        session_id: UUID,
        candidate_message: str,
        retrieved_context: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        state = self.get_session(session_id)
        context_lines = []
        for item in retrieved_context:
            similarity = round(float(item.get("similarity", 0.0)), 3)
            context_lines.append(
                f"- similarity={similarity} | source={item['source_filename']} | text={item['chunk_text']}"
            )

        prompt = (
            f"Role applied for: {state.role_name}\n"
            f"CV summary:\n{state.cv_summary}\n\n"
            f"Interview complete after {state.max_questions} candidate answers.\n"
            f"Candidate's latest reply:\n{candidate_message}\n\n"
            f"Retrieved CV context:\n{chr(10).join(context_lines)}\n\n"
            f"Interview history:\n{state.history}"
        )
        return [*state.history, {"role": "user", "content": prompt}]
