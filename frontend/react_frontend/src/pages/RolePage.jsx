import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { StepShell } from '../components/StepShell';
import { useInterview } from '../context/interview-context';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

const levels = ['Intern', 'Junior', 'Mid', 'Senior'];

export function RolePage() {
  const navigate = useNavigate();
  const { state, setRoleDetails } = useInterview();

  if (!state.cvFile) return <Navigate to="/setup/cv" replace />;

  function handlePositionChange(event) {
    setRoleDetails({ jobPosition: event.target.value, jobLevel: state.jobLevel });
  }

  function handleLevelSelect(jobLevel) {
    setRoleDetails({ jobPosition: state.jobPosition, jobLevel });
  }

  function handleNext(event) {
    event.preventDefault();
    if (!state.jobPosition.trim()) return;
    navigate('/setup/mode');
  }

  return (
    <StepShell 
      currentStep={2} 
      title="Define Role" 
      description="Set the target position and seniority to flavor the interviewer persona."
    >
      <form onSubmit={handleNext} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="job-position" className="text-sm font-medium">
            Job Position
          </label>
          <Input
            id="job-position"
            type="text"
            value={state.jobPosition}
            onChange={handlePositionChange}
            placeholder="e.g. Frontend Engineer"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Seniority Level</label>
          <div className="grid grid-cols-2 gap-3">
            {levels.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => handleLevelSelect(level)}
                className={cn(
                  "relative p-4 rounded-md border-2 transition-all text-left",
                  state.jobLevel === level
                    ? "border-foreground bg-muted"
                    : "border-border hover:border-muted-foreground"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{level}</span>
                  {state.jobLevel === level && (
                    <div className="w-5 h-5 rounded-full bg-foreground flex items-center justify-center">
                      <Check className="w-3 h-3 text-background" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-4">
          <Button variant="ghost" type="button" onClick={() => navigate('/setup/cv')} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button type="submit" disabled={!state.jobPosition.trim()} className="gap-2">
            Next Step
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </form>
    </StepShell>
  );
}
