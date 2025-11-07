# Unified Workspace Panel Architecture

## Overview

The Setup Panel has been redesigned to provide a more streamlined and intuitive user experience. Instead of showing all configuration options in a single long page with collapsible sections, the new design uses a card-based overview with slide-in sub-pages for detailed configuration.

## Architecture

### Main Components

1. **SetupPanel.ts** - Main panel controller that manages the webview and handles communication
2. **HostToolsSubPage.ts** - Sub-page for host tools installation and management
3. **SDKSubPage.ts** - Sub-page for Zephyr SDK installation and version management
4. **WorkspaceSubPage.ts** - Sub-page for workspace setup and configuration
5. **setup-panel.js** - Client-side navigation and interaction logic
6. **setup-panel.css** - Styles including slide-in animations

### User Flow

1. User opens the Setup Panel (via command or ExtensionSetupView)
2. Overview cards display the current status of:
   - Host Tools (Ready/Setup Required)
   - Zephyr SDK (Installed/Not Installed)
   - Workspace (Initialized/Setup Required/No Folder)
3. Clicking a card slides in the corresponding sub-page from the right
4. Back button returns to the overview with a slide-out animation

### Navigation

The panel uses a two-level navigation:
- **Overview Level**: Shows status cards for all setup areas
- **Sub-Page Level**: Shows detailed information and actions for a specific area

Navigation is handled via message passing:
```javascript
// Navigate to a sub-page
navigateToSubPage('hosttools' | 'sdk' | 'workspace')

// Return to overview
navigateToOverview()
```

### Sub-Page Structure

Each sub-page follows a consistent structure:

```typescript
export class SubPageName {
    static getHtml(config: Config): string {
        return `
            <div class="sub-page-content">
                <div class="sub-page-header">
                    <button class="back-button" onclick="navigateToOverview()">
                        Back to Overview
                    </button>
                    <h2>Page Title</h2>
                </div>
                
                <div class="sub-page-body">
                    <div class="status-banner">Status</div>
                    <p class="description">Description</p>
                    <!-- Content sections -->
                </div>
            </div>
        `;
    }
}
```

## CSS Architecture

### Layout System

The panel uses absolute positioning with CSS transitions for smooth animations:

```css
.panel-container {
    /* Fixed container for overflow control */
}

.overview-container {
    /* Main overview, slides left when hidden */
    transform: translateX(-100%) when hidden
}

.sub-page-container {
    /* Sub-pages slide in from right */
    transform: translateX(100%) when hidden
    transform: translateX(0) when visible
}
```

### Animation

Transitions are 0.3s ease-in-out for a smooth, professional feel:
- Overview slides left/right
- Sub-page slides right/left
- Opacity fades in/out
- Cards have hover effects with subtle transform and shadow

## Message Protocol

### From Webview to Extension

```typescript
// Navigate to sub-page
{ command: 'navigateToPage', page: 'hosttools' | 'sdk' | 'workspace' | 'overview' }

// Action commands (existing)
{ command: 'installSDK' }
{ command: 'openHostToolsPanel' }
{ command: 'workspaceSetupFromGit' }
// ... etc
```

### From Extension to Webview

```typescript
// Show sub-page content
{ command: 'showSubPage', content: string, page: string }

// SDK list results
{ command: 'sdkListResult', data: ParsedSDKList }
```

## Features

### Overview Cards
- Visual status indicators (✓, ⚠, ✗, 📁)
- Color-coded status badges
- Hover effects with elevation
- Click-to-navigate with arrow indicator

### Sub-Pages
- Consistent back button navigation
- Status banners with clear visual feedback
- Organized sections for related content
- Action buttons with icons
- Responsive layout

### Host Tools Sub-Page
- Lists required tools
- Link to advanced Host Tools Manager
- Option to mark tools as installed

### SDK Sub-Page
- Install/Update SDK functionality
- List available SDKs with toolchain details
- Dynamic content loading

### Workspace Sub-Page
- Different states: No Folder, Setup Required, Initialized
- Multiple workspace setup options:
  - Import from Git (Zephyr IDE workspace)
  - Import from Git (West workspace)
  - New standard workspace
  - Initialize current directory
- West configuration access

## Benefits

1. **Reduced Cognitive Load**: Users see only relevant information at each step
2. **Clear Visual Hierarchy**: Overview → Details navigation pattern
3. **Better Organization**: Related functionality grouped in dedicated sub-pages
4. **Smooth Transitions**: Professional animations improve UX
5. **Maintainable Code**: Separate files for each sub-page
6. **Consistent Experience**: All sub-pages follow the same structure

## Future Enhancements

Potential improvements for future iterations:
- Breadcrumb navigation for complex workflows
- Progress indicators for multi-step processes
- Keyboard shortcuts for navigation
- Deep linking to specific sub-pages
- Search/filter functionality within sub-pages
