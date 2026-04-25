import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload, FileText, ArrowLeft, ArrowRight } from 'lucide-react';
import { StepShell } from '../components/StepShell';
import { useInterview } from '../context/interview-context';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';

export function UploadPage() {
  const navigate = useNavigate();
  const { state, setCvFile } = useInterview();

  const fileSizeLabel = useMemo(() => {
    if (!state.cvFile) return '';
    const sizeMb = state.cvFile.size / (1024 * 1024);
    return `${sizeMb.toFixed(2)} MB`;
  }, [state.cvFile]);

  function handleNext(event) {
    event.preventDefault();
    if (!state.cvFile) return;
    navigate('/setup/role');
  }

  return (
    <StepShell 
      currentStep={1} 
      title="Upload Candidate CV" 
      description="Provide a PDF resume to ground the interview context."
    >
      <form onSubmit={handleNext} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="cv-upload" className="text-sm font-medium">
            Candidate CV
          </label>
          <div className="relative">
            <Input
              id="cv-upload"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => setCvFile(event.target.files?.[0] ?? null)}
              required
              className="cursor-pointer"
            />
          </div>
        </div>

        {state.cvFile && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-muted">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{state.cvFileName}</p>
                  <p className="text-xs text-muted-foreground mt-1">{fileSizeLabel}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between pt-4">
          <Button variant="ghost" asChild>
            <Link to="/" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </Button>
          <Button type="submit" disabled={!state.cvFile} className="gap-2">
            Next Step
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </form>
    </StepShell>
  );
}
