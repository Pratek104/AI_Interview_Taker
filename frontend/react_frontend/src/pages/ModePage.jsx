import { startTransition, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Mic, Check, Shield } from 'lucide-react';
import { StepShell } from '../components/StepShell';
import { useInterview } from '../context/interview-context';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const modes = [
  { 
    value: 'voice', 
    title: 'Voice-led', 
    description: 'Agent speaks aloud',
    icon: Mic 
  },
  { 
    value: 'chat', 
    title: 'Chat-led', 
    description: 'Text-first exchange',
    icon: MessageSquare 
  },
  {
    value: 'computer_vision',
    title: 'Computer Vision',
    description: 'Camera and screen-share proctoring with merit tracking',
    icon: Shield
  },
];

export function ModePage() {
  const navigate = useNavigate();
  const { state, setInterviewMode, beginInterview } = useInterview();
  const [error, setError] = useState('');

  if (!state.cvFile) return <Navigate to="/setup/cv" replace />;
  if (!state.jobPosition.trim()) return <Navigate to="/setup/role" replace />;

  async function handleStart() {
    setError('');
    try {
      await beginInterview();
      startTransition(() => navigate('/interview'));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <StepShell 
      currentStep={3} 
      title="Interview Style" 
      description="Choose voice, chat, or proctored computer-vision assessment."
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => setInterviewMode(mode.value)}
                className={cn(
                  "relative p-6 rounded-md border-2 transition-all text-left",
                  state.interviewMode === mode.value
                    ? "border-foreground bg-muted"
                    : "border-border hover:border-muted-foreground"
                )}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-2 rounded-md bg-background border">
                      <Icon className="w-5 h-5" />
                    </div>
                    {state.interviewMode === mode.value && (
                      <div className="w-5 h-5 rounded-full bg-foreground flex items-center justify-center">
                        <Check className="w-3 h-3 text-background" />
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{mode.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {mode.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-4">
          <Button variant="ghost" type="button" onClick={() => navigate('/setup/role')} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button onClick={handleStart} disabled={state.sessionLoading}>
            {state.sessionLoading ? 'Starting...' : 'Enter Room'}
          </Button>
        </div>
      </div>
    </StepShell>
  );
}
