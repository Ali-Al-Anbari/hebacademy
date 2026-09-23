# Hebacademy — Product Requirements Document

## 1. Product Overview

**Product name:** Hebacademy

**Purpose:**  
Hebacademy is a modern study web application built initially for a single optometry student. It helps organize school material into courses, decks, and flashcards, then supports studying through flashcards, self-assessment, progress tracking, and multiple-choice quizzes.

The product should be useful enough for real daily studying while also being engineered cleanly enough to discuss in a software engineering interview or include on a resume.

---

## 2. Product Goals

Hebacademy should:

- Make it fast to organize study material by course and deck.
- Make flashcard creation simple and efficient.
- Support images on either side of a flashcard.
- Allow the learner to type a response before revealing the answer.
- Track card-level learning progress over time.
- Let the learner classify each reviewed card as:
  - Review Again
  - Needs Practice
  - Mastered
- Support starring/flagging important cards.
- Support multiple-choice quiz mode.
- Work well on desktop and mobile.
- Be inexpensive to operate.
- Remain simple enough to understand and maintain.

---

## 3. Primary User

Version 1 is designed for **one primary user**, an optometry student who will use Hebacademy frequently for professional-school studying.

The app should still use proper authentication, ownership, and Row Level Security so the architecture is safe and can support additional users later without a major rewrite.

---

## 4. Core Information Architecture

The primary hierarchy is:

```text
User
  └── Courses
        └── Decks
              └── Cards
```

Example:

```text
Optometry School
  └── Ocular Anatomy
        ├── Chapter 1
        ├── Chapter 2
        └── Chapter 3
```

---

## 5. Current Technology Stack

### Frontend / Full Stack
- Next.js 16
- React
- TypeScript
- App Router
- Tailwind CSS

### Backend / Data
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Row Level Security

### Hosting
- Vercel

### Source Control
- GitHub

### UI Foundation
- shadcn/ui should be used as the primary reusable component foundation.
- 21st.dev may be used for inspiration or selected component patterns.
- Avoid copying unrelated templates wholesale.

---

## 6. Current Core Features

### Authentication
- Email/password login.
- No public sign-up flow.
- Routes are protected.
- Signed-out users are redirected to login.
- Signed-in users can sign out.
- Supabase Auth is used.

### Courses
Users can:
- Create a course.
- Rename a course.
- Delete a course.
- View decks inside a course.

### Decks
Users can:
- Create a deck inside a course.
- Rename a deck.
- Add/edit an optional description.
- Delete a deck.
- Navigate into a deck.

### Cards
Users can:
- Create cards.
- Edit cards.
- Delete cards.
- Reorder cards.
- Star/unstar cards.
- Add prompt-side images.
- Add answer-side images.

Each card includes:
- Prompt
- Answer
- Optional prompt image
- Optional answer image
- Starred state
- Position/order

### Flashcard Study Mode
Users can:
- Start a study session.
- View one card at a time.
- Type an optional response before revealing the answer.
- Reveal the correct answer.
- Compare their answer manually.
- Rate the card:
  - Review Again
  - Needs Practice
  - Mastered
- Continue through the deck.
- View completion counts.

Typed answers are not currently persisted.

### Study Progress
The deck page shows:
- Total cards
- Mastered cards
- Needs Practice cards
- Review Again cards
- Not Studied cards
- Completed study sessions
- Last studied time

A card's current state is derived from its most recent review.

### Quiz Mode
Users can:
- Start a multiple-choice quiz from a deck.
- Receive one correct answer and distractors from other cards in the deck.
- Answer one question at a time.
- Receive immediate feedback.
- View final score.
- Review missed questions.

Quiz attempts are not currently persisted.

---

## 7. Study Data Model

### study_sessions
Tracks individual study sessions.

Important fields:
- id
- user_id
- deck_id
- mode
- started_at
- completed_at

Current supported mode:
- flashcards

### card_reviews
Stores immutable review history.

Important fields:
- id
- user_id
- card_id
- study_session_id
- rating
- reviewed_at

Allowed ratings:
- review_again
- needs_practice
- mastered

Historical reviews must be preserved rather than overwriting one status value.

---

## 8. Security Requirements

Hebacademy is an internet-facing application.

Requirements:

- Never expose Supabase service-role credentials to the client.
- Never commit secrets.
- Keep secrets in environment variables.
- Use Supabase Row Level Security.
- Users may only access their own:
  - courses
  - decks
  - cards
  - study sessions
  - card reviews
  - uploaded card images
- Parent-child ownership must be validated.
- Private images should remain in a private Supabase Storage bucket.
- Use signed URLs to display private card images.
- Do not bypass RLS to make features easier to implement.

---

# 9. DESIGN REQUIREMENTS

## 9.1 Visual Direction

Hebacademy should look like a **modern, premium study/productivity application**.

The design should feel:

- Modern
- Clean
- Polished
- Friendly
- Calm
- Focused
- Slightly feminine
- Appropriate for a serious professional-school student

The product should NOT look like:

- a generic CRUD dashboard
- a default Tailwind demo
- an obviously AI-generated website
- an editorial/blog site
- a children's learning app
- a corporate enterprise admin panel

---

## 9.2 Pink Brand Direction

Pink is the primary brand identity, but it should be used with restraint.

Preferred palette direction:

### Primary
Muted raspberry / rose pink.

Example direction:
- Primary: `#DB5C8A`
- Primary hover: `#C94677`
- Deep accent: `#A93663`

Exact colors may be adjusted during visual implementation.

### Background
Use:
- near-white
- very pale blush
- soft neutral pink-tinted surfaces

Example direction:
- Page background: `#FFF9FB`
- Soft section background: `#FDF1F5`
- Card surface: `#FFFFFF`

### Text
- Primary text: dark charcoal
- Secondary text: warm gray
- Avoid pure black where unnecessary.

### Semantic Status Colors
Pink should not replace useful semantic colors.

Use distinct restrained colors for:

- Mastered → soft green
- Needs Practice → warm amber
- Review Again → rose/red
- Not Studied → neutral gray

---

## 9.3 Typography

Use a modern application-style type hierarchy.

Avoid:
- giant serif editorial headings
- oversized decorative headlines
- typography that looks like a magazine or blog

Prefer:
- modern sans-serif typography
- clear weights
- compact product page headings
- excellent readability

Page titles should feel like application titles, not hero sections.

---

## 9.4 Layout

Use purposeful whitespace.

Avoid:
- huge empty vertical gaps
- excessive page width
- content floating without structure
- every element being wrapped in an outline

Preferred behavior:
- centered content area
- sensible max-width
- clear section grouping
- compact headers
- consistent spacing rhythm
- responsive layouts

Desktop layouts should use available width intelligently.

Mobile should feel intentionally designed, not merely shrunk.

---

## 9.5 Cards and Containers

Cards should feel modern and intentional.

Prefer:
- white or lightly tinted surfaces
- medium rounded corners
- subtle shadows
- restrained borders
- clear hover states
- strong internal spacing

Avoid:
- thin gray outlines around every element
- nested bordered rectangles
- giant fieldset-style forms
- decorative index numbers without purpose
- excessive shadows

Use borders only when they improve separation.

---

## 9.6 Buttons

Use a clear hierarchy.

### Primary
- filled pink/raspberry
- strong contrast
- clear hover/focus state

Examples:
- Add Course
- Add Deck
- Create Card
- Start Study
- Reveal Answer
- Save

### Secondary
- neutral or pale pink surface
- understated

Examples:
- Cancel
- Back
- Edit

### Destructive
- restrained red treatment
- never visually compete with the main action

Examples:
- Delete

Avoid:
- tiny raw text links for important actions
- unclear click targets
- multiple buttons competing equally

---

## 9.7 Forms

Forms must look intentionally designed.

Use:
- separate labels
- comfortable field spacing
- clear form titles
- polished inputs/textareas
- pink focus rings
- intentional primary/secondary actions

Avoid:
- wrapping the entire form in a thin outlined box
- raw browser-looking fields
- action text with no button styling
- cramped controls

Creation forms may use:
- Dialog
- Sheet
- Drawer on mobile
- polished inline card

Choose based on the interaction.

---

## 9.8 Navigation

Navigation should make the hierarchy obvious:

```text
Dashboard
→ Course
→ Deck
→ Study / Quiz
```

Use:
- clear breadcrumbs
- consistent header
- visible back navigation
- meaningful page titles

Avoid repetitive navigation labels when hierarchy already makes the destination clear.

---

## 9.9 Dashboard

Dashboard should prominently show:

- Hebacademy identity
- Your Courses
- Add Course action
- Course cards

Course cards should communicate useful information such as:
- course name
- number of decks
- potentially recent activity later

They should feel clickable and polished.

---

## 9.10 Course Page

Course page should contain:

- breadcrumb/back navigation
- compact course title
- deck count
- Add Deck button
- deck cards/grid

Deck cards should include:
- deck name
- description if present
- card count when available
- clean edit/delete actions

Avoid decorative numbering like `01`, `02` unless it provides genuine value.

---

## 9.11 Deck Page

Deck page should emphasize:

- deck title
- Study action
- Quiz action
- progress summary
- card management

The primary hierarchy should be:

1. Study
2. Quiz
3. Manage cards

Do not make management controls visually overpower the actual studying experience.

---

## 9.12 Flashcard Study Screen

The flashcard is the visual focal point.

Requirements:
- strong centered card
- comfortable reading width
- prominent prompt
- prompt image displayed naturally
- clear typed-response field
- obvious Reveal Answer button
- answer side visually distinct after reveal
- learner's typed response remains visible
- rating controls are easy to distinguish and tap

Ratings:
- Review Again
- Needs Practice
- Mastered

These should have distinct visual treatments without becoming overly colorful.

Study UI should minimize distraction.

---

## 9.13 Quiz Screen

Answer choices should feel like polished selectable cards/buttons.

Requirements:
- clear question hierarchy
- large tap targets
- selected state
- correct state
- incorrect state
- clear Next Question action
- compact progress display

Completion screen should clearly show:
- score
- correct count
- incorrect count
- missed questions

---

## 9.14 Progress UI

Progress should be easy to understand at a glance.

Display:
- Mastered
- Needs Practice
- Review Again
- Not Studied

Prefer:
- compact stat cards
- badges
- segmented progress
- restrained visual indicators

Do not add charts simply for decoration.

---

## 9.15 Responsive Design

Every major screen must work well on mobile.

Mobile requirements:
- readable spacing
- 44px+ practical touch targets
- full-width primary actions where useful
- forms should not overflow
- cards should stack naturally
- dialogs should become mobile-friendly drawers/sheets if appropriate
- no tiny action text

---

# 10. UI Component Strategy

Use **shadcn/ui** as the base component system.

Preferred primitives include:

- Button
- Card
- Input
- Textarea
- Label
- Dialog
- AlertDialog
- DropdownMenu
- Breadcrumb
- Badge
- Separator
- Sheet
- Progress
- Skeleton

Do not install every shadcn component preemptively.

Add components only when actually needed.

### 21st.dev

21st.dev may be used for:
- visual inspiration
- specific component ideas
- selected free components

Rules:
- Do not pay for 21st.dev.
- Do not depend on paid components.
- Do not copy a complete random template.
- Adapt components to Hebacademy's design system.
- Preserve visual consistency.

---

# 11. AI Coding Guidelines

The application is developed with AI assistance, but changes should remain understandable.

### Model guidance

**Luna**
Use for:
- small CSS changes
- wording
- isolated component tweaks
- minor responsive fixes

**Sol**
Use for:
- normal feature implementation
- multi-file UI changes
- database work
- React state
- Supabase integration
- meaningful redesign work

**Terra**
Reserve for:
- difficult architecture problems
- hard authorization/RLS bugs
- deep debugging
- security audits
- complex performance issues

Do not use expensive/high-reasoning models when a simpler model is sufficient.

---

# 12. Engineering Rules

For every meaningful AI-generated change:

1. Inspect the changed files.
2. Understand important logic.
3. Run lint.
4. Run production build when appropriate.
5. Manually test affected behavior.
6. Inspect `git diff`.
7. Commit only after the logical unit works.

Do not blindly accept agent changes.

Avoid:
- unnecessary abstractions
- repository/service layers without need
- state-management libraries without need
- premature optimization
- unrelated cleanup during feature work
- unnecessary dependencies

Prefer boring, understandable code.

---

# 13. Git Workflow

Use `main` for:
- small UI work
- routine improvements
- low-risk isolated changes

Use feature branches for:
- significant new features
- major architecture work
- risky experiments
- substantial authentication/database changes

Commit messages should describe one logical milestone.

---

# 14. Performance

Do not optimize based only on perception.

If performance feels slow:

1. Compare development and production mode.
2. Measure where time is spent.
3. Check:
   - Supabase queries
   - server actions
   - authentication calls
   - path revalidation
   - signed image URLs
4. Optimize only verified bottlenecks.

Do not fabricate performance metrics.

---

# 15. Cost Requirements

The project should remain inexpensive.

Target during initial use:

**$0/month infrastructure cost**

Preferred:
- Vercel free tier
- Supabase free tier
- free/open-source UI components

Do not introduce paid services unless there is a strong future reason and the project owner explicitly approves it.

---

# 16. Current Non-Goals

Do NOT build these yet unless requirements change:

- public study sets
- social features
- collaboration
- leaderboards
- teacher/classroom features
- AI-generated flashcards
- AI-generated quizzes
- OCR
- PDF import
- complex spaced repetition
- detailed analytics dashboards
- streak systems
- public signup
- paid services

---

# 17. Planned Future Features

Potential future work includes:

- Quizlet import
- CSV import/export
- smarter card filtering
- study only starred cards
- study only weak cards
- better recommendation of cards to review
- spaced repetition
- quiz persistence
- detailed learning analytics

These should be added only after real usage demonstrates value.

---

# 18. Immediate Product Priorities

Current priority order:

1. Establish a polished modern pink UI system.
2. Replace inconsistent/raw controls with shadcn/ui primitives.
3. Improve Dashboard, Course, and Deck visual hierarchy.
4. Improve card creation/editing ergonomics.
5. Polish Flashcard Study.
6. Polish Quiz mode.
7. Perform responsive/mobile review.
8. Deploy to Vercel.
9. Let the primary user study with it.
10. Use real feedback to determine the next feature.

---

# 19. Definition of Done for Visual Redesign

The redesign is complete when:

- Hebacademy looks like a cohesive modern product.
- Pink branding is recognizable but restrained.
- No screen looks like a raw CRUD interface.
- Forms feel intentionally designed.
- Buttons have consistent hierarchy.
- Cards use consistent radius, surface, shadow, and spacing.
- Dashboard, Course, Deck, Study, Quiz, and Login clearly belong to the same application.
- Mobile looks intentionally designed.
- All existing functionality still works.
- Authentication and Supabase behavior are unchanged.
- Lint and production build pass.

---

# 20. Product Principle

**Function first, polish deliberately, complexity only when earned.**

Hebacademy should be pleasant enough to use every day, simple enough to understand, and engineered well enough to explain confidently in an interview.
