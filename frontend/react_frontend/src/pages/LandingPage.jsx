import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between max-w-6xl">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-foreground" />
            <span className="font-semibold text-sm">Interview Studio</span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-3xl mx-auto text-center space-y-8 py-20">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-muted/50 text-xs text-muted-foreground">
            <Sparkles className="w-3 h-3" />
            <span>AI-Powered Interview Platform</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            AI Interview Taker
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A minimal, production-level platform for CV-grounded technical interviews. 
            Experience intelligent conversations tailored to your resume.
          </p>

          <div className="flex items-center justify-center gap-4 pt-4">
            <Button asChild size="lg" className="gap-2">
              <Link to="/setup/cv">
                Start Interview
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground max-w-6xl">
          <p>Powered by advanced AI technology</p>
        </div>
      </footer>
    </div>
  );
}
