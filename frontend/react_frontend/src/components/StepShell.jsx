import { cn } from '../lib/utils';

export function StepShell({ currentStep, title, description, children }) {
  const steps = [
    { number: 1, label: 'Upload CV' },
    { number: 2, label: 'Define Role' },
    { number: 3, label: 'Choose Mode' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between max-w-4xl">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-foreground" />
            <span className="font-semibold text-sm">Interview Studio</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12 px-4">
        <div className="container mx-auto max-w-2xl space-y-8">
          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-2">
            {steps.map((step, idx) => (
              <div key={step.number} className="flex items-center">
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                      step.number < currentStep
                        ? "bg-foreground text-background"
                        : step.number === currentStep
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {step.number}
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {step.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={cn(
                      "w-12 sm:w-20 h-[2px] mx-2 transition-colors",
                      step.number < currentStep ? "bg-foreground" : "bg-muted"
                    )}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Content Card */}
          <div className="space-y-6">
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
              <p className="text-muted-foreground">{description}</p>
            </div>

            <div className="border rounded-lg bg-card p-6 shadow-sm">
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
