# Frontend Design System

## Overview
This frontend has been completely redesigned with a minimalistic, aesthetic approach using **shadcn/ui** and **Tailwind CSS**.

## Design Philosophy
- **Minimalistic**: Clean, uncluttered interfaces with focus on content
- **Aesthetic**: Subtle borders, refined spacing, and elegant typography
- **No Flashy Colors**: Neutral color palette with black, white, and grays
- **Modern**: Contemporary UI patterns with smooth transitions

## Tech Stack
- **React 19** - Latest React with modern hooks
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality, accessible component library
- **Lucide React** - Beautiful, consistent icons
- **Radix UI** - Unstyled, accessible component primitives

## Components

### UI Components (shadcn/ui based)
Located in `src/components/ui/`:
- `button.jsx` - Primary, secondary, outline, and ghost button variants
- `input.jsx` - Text input with focus states
- `textarea.jsx` - Multi-line text input
- `card.jsx` - Container component with header, content, and footer
- `badge.jsx` - Small status indicators

### Custom Components
- `StepShell.jsx` - Wrapper for setup flow pages with progress indicator

## Pages

### 1. Landing Page
- Hero section with centered content
- Minimal header with brand identity
- Single CTA button to start interview
- Clean footer

### 2. Upload Page (Step 1)
- File upload with visual feedback
- File preview card showing name and size
- Progress indicator at top
- Navigation buttons

### 3. Role Page (Step 2)
- Text input for job position
- Grid of selectable seniority levels
- Visual selection states with checkmarks
- Consistent navigation

### 4. Mode Page (Step 3)
- Two interview mode options (Voice/Chat)
- Icon-based cards with descriptions
- Clear visual selection feedback
- Final step before entering interview

### 5. Interview Page
- Split layout: Chat (2/3) + Context Sidebar (1/3)
- Sticky header with session info
- Real-time message display
- Voice controls (when in voice mode)
- RAG context display in sidebar
- Smooth scrolling and animations

## Color Scheme
Using CSS variables for easy theming:
- Background: White (`hsl(0 0% 100%)`)
- Foreground: Near Black (`hsl(0 0% 3.9%)`)
- Muted: Light Gray (`hsl(0 0% 96.1%)`)
- Border: Subtle Gray (`hsl(0 0% 89.8%)`)

## Typography
- System font stack with fallbacks
- Clear hierarchy with font weights
- Readable line heights
- Proper letter spacing

## Responsive Design
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px)
- Grid layouts adapt to screen size
- Touch-friendly button sizes

## Accessibility
- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support
- Focus visible states
- Proper color contrast

## Getting Started

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

## File Structure
```
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   │   ├── button.jsx
│   │   ├── input.jsx
│   │   ├── textarea.jsx
│   │   ├── card.jsx
│   │   └── badge.jsx
│   └── StepShell.jsx    # Custom wrapper component
├── pages/
│   ├── LandingPage.jsx
│   ├── UploadPage.jsx
│   ├── RolePage.jsx
│   ├── ModePage.jsx
│   └── InterviewPage.jsx
├── lib/
│   ├── api.js           # API calls
│   └── utils.js         # Utility functions (cn)
├── context/
│   ├── interview-context.js
│   └── InterviewProvider.jsx
├── App.jsx
├── main.jsx
└── index.css            # Tailwind + custom styles
```

## Key Features
- ✅ Completely redesigned UI
- ✅ shadcn/ui component library
- ✅ Tailwind CSS utility classes
- ✅ Minimalistic design
- ✅ No flashy colors
- ✅ Smooth animations
- ✅ Responsive layout
- ✅ Accessible components
- ✅ Clean typography
- ✅ Modern icons (Lucide)

## Customization
To customize the design, edit:
- `tailwind.config.js` - Theme configuration
- `src/index.css` - CSS variables and global styles
- Component files - Individual component styling
