import { useEffect, useState } from 'react'
import { getFrontendConfig, getHealth, sendChatMessage, uploadCandidateCv } from '../lib/api'
import { InterviewContext } from './interview-context'

const initialState = {
  cvFile: null,
  cvFileName: '',
  jobPosition: '',
  jobLevel: 'Mid',
  interviewMode: 'voice',
  sessionId: '',
  roleName: '',
  phase: 'introduction',
  summary: '',
  chunkCount: 0,
  openingMessage: '',
  messages: [],
  retrievedContext: [],
  defaultVoice: 'austin',
  apiReady: false,
  configLoaded: false,
  sessionLoading: false,
}

function makeMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  }
}

function composeRoleName(level, position) {
  return `${level} ${position}`.trim()
}

export function InterviewProvider({ children }) {
  const [state, setState] = useState(initialState)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        await getHealth()
        const config = await getFrontendConfig()
        if (!active) {
          return
        }
        setState((current) => ({
          ...current,
          apiReady: true,
          configLoaded: true,
          defaultVoice: config.default_voice || current.defaultVoice,
        }))
      } catch {
        if (!active) {
          return
        }
        setState((current) => ({
          ...current,
          apiReady: false,
          configLoaded: true,
        }))
      }
    }

    bootstrap()
    return () => {
      active = false
    }
  }, [])

  function clearSessionRuntime() {
    setState((current) => ({
      ...current,
      sessionId: '',
      roleName: '',
      phase: 'introduction',
      summary: '',
      chunkCount: 0,
      openingMessage: '',
      messages: [],
      retrievedContext: [],
      sessionLoading: false,
    }))
  }

  function setCvFile(file) {
    setState((current) => ({
      ...current,
      cvFile: file,
      cvFileName: file?.name || '',
      sessionId: '',
      messages: [],
      retrievedContext: [],
    }))
  }

  function setRoleDetails({ jobPosition, jobLevel }) {
    setState((current) => ({
      ...current,
      jobPosition,
      jobLevel,
      sessionId: '',
      roleName: '',
      messages: [],
      retrievedContext: [],
    }))
  }

  function setInterviewMode(interviewMode) {
    setState((current) => ({
      ...current,
      interviewMode,
    }))
  }

  async function beginInterview() {
    const { cvFile, jobPosition, jobLevel } = state

    if (!cvFile) {
      throw new Error('Upload a CV before starting the interview.')
    }
    if (!jobPosition.trim()) {
      throw new Error('Enter the job position before starting the interview.')
    }

    const roleName = composeRoleName(jobLevel, jobPosition)

    setState((current) => ({
      ...current,
      sessionLoading: true,
    }))

    try {
      const payload = await uploadCandidateCv({
        roleName,
        file: cvFile,
      })

      setState((current) => ({
        ...current,
        roleName,
        sessionId: payload.session_id,
        phase: payload.current_phase,
        summary: payload.cv_summary,
        chunkCount: payload.chunk_count,
        openingMessage: payload.opening_message,
        messages: [makeMessage('assistant', payload.opening_message)],
        retrievedContext: [],
        sessionLoading: false,
      }))

      return payload
    } catch (error) {
      setState((current) => ({
        ...current,
        sessionLoading: false,
      }))
      throw error
    }
  }

  async function submitCandidateMessage(message) {
    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      throw new Error('Write or dictate an answer before sending.')
    }
    if (!state.sessionId) {
      throw new Error('Start the interview before sending responses.')
    }

    const userMessage = makeMessage('user', trimmedMessage)

    setState((current) => ({
      ...current,
      messages: [...current.messages, userMessage],
    }))

    try {
      const payload = await sendChatMessage({
        sessionId: state.sessionId,
        message: trimmedMessage,
      })

      setState((current) => ({
        ...current,
        phase: payload.phase,
        retrievedContext: payload.retrieved_context,
        messages: [...current.messages, makeMessage('assistant', payload.answer)],
      }))

      return payload
    } catch (error) {
      setState((current) => ({
        ...current,
        messages: current.messages.filter((entry) => entry.id !== userMessage.id),
      }))
      throw error
    }
  }

  const value = {
    state,
    setCvFile,
    setRoleDetails,
    setInterviewMode,
    beginInterview,
    submitCandidateMessage,
    clearSessionRuntime,
    composeRoleName,
  }

  return <InterviewContext.Provider value={value}>{children}</InterviewContext.Provider>
}
