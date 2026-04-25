import { createContext, useContext } from 'react'

export const InterviewContext = createContext(null)

export function useInterview() {
  const context = useContext(InterviewContext)
  if (!context) {
    throw new Error('useInterview must be used inside InterviewProvider')
  }
  return context
}
