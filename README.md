# GhostComplete - Smart Autocomplete for React

[![Version](https://img.shields.io/npm/v/@your-scope/ghostcomplete)](https://npmjs.com/package/@your-scope/ghostcomplete)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Size](https://img.shields.io/badge/package%20size-38kB-brightgreen)](https://npmjs.com/package/ghostcomplete)

**GhostComplete** is a lightweight smart autocomplete library (38kB) specifically designed to solve React controlled component challenges while providing word learning capabilities. Unlike traditional autocomplete solutions that often break with React's controlled inputs, GhostComplete seamlessly integrates with React's state management and learns common words to provide relevant suggestions.

## 🎯 Why GhostComplete?

### The React Controlled Component Problem

In React, controlled components manage their own state, which often conflicts with browser autocomplete:

```jsx
// ❌ Traditional autocomplete often breaks with controlled inputs
const [value, setValue] = useState('');
return (
  <input 
    value={value} 
    onChange={(e) => setValue(e.target.value)}
    autoComplete="on" // This often doesn't work as expected
  />
);
```

### The GhostComplete Solution

```jsx
// ✅ GhostComplete works seamlessly with controlled components
import 'ghostcomplete'; // Automatically initializes and exposes GhostComplete globally

const [value, setValue] = useState('');
return (
  <input 
    value={value} 
    onChange={(e) => setValue(e.target.value)}
    data-autocomplete="search" // Smart word completion that learns
  />
);
```

## 🚀 Key Features

- **🔧 React-Friendly**: Designed specifically for React controlled components
- **📦 Lightweight**: Only 38kB package size, optimized for production
- **🧠 Word Learning**: Learns common words from user input and suggests them
- **👥 Group Management**: Organize completions by context (forms, search, comments, etc.)
- **💾 Persistent Memory**: Stores learned words in localStorage for future sessions
- **🎨 Highly Customizable**: Extensive theming and configuration options
- **📱 Mobile Optimized**: Touch-friendly interface with responsive design
- **⌨️ Keyboard Navigation**: Full keyboard support with arrow keys and Tab completion

## 📦 Installation

```bash
npm install ghostcomplete
```

After installation, simply import the library and it will automatically attach to all inputs with the `data-autocomplete` attribute:

```javascript
// Import the library (automatically initializes)
import 'ghostcomplete';

// Or if using CommonJS
require('ghostcomplete');
```

Or include via CDN:

```html
<script src="https://unpkg.com/ghostcomplete@latest/dist/index.umd.js"></script>
```

The library automatically exposes a global `GhostComplete` object with all the API methods.

## 🎬 Quick Start

### ✅ Automatic Usage (Recommended)

```html
<!-- Just add data-autocomplete attribute - no manual init needed! -->
<input type="text" data-autocomplete="search" placeholder="Start typing...">
<textarea data-autocomplete="comments" placeholder="Write your comment..."></textarea>

<script>
// Import the library (automatically detects and initializes inputs)
import 'ghostcomplete';

// That's it! Elements with data-autocomplete work automatically
// Configure groups as needed:
GhostComplete.setGroupConfig('search', {
  MAX_SUGGESTIONS: 8,
  DEBOUNCE_DELAY: 100
});
</script>
```

### ⚠️ Manual Initialization (When Needed)

Manual `init()` calls are only required for:
- **Dynamic elements** created after page load
- **React components** (useEffect hooks)
- **Elements without** `data-autocomplete` attribute

```javascript
// For dynamically created elements
const newInput = document.createElement('input');
GhostComplete.init(newInput, 'search');

// For all elements at once
GhostComplete.initAll('default');

// For specific elements
GhostComplete.init('#my-input', 'search');
```

### React Integration

```jsx
import { useEffect, useRef, useState } from 'react';
// Import GhostComplete (this automatically sets up event listeners)
import 'ghostcomplete';

function SmartInput({ group = "default", ...props }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    // Manual init required for React components
    if (inputRef.current) {
      GhostComplete.init(inputRef.current, group);
    }
  }, [group]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      data-autocomplete={group}
      {...props}
    />
  );
}

// For static HTML elements, no init() needed:
// <input data-autocomplete="search" placeholder="Search..." />

// Usage
function App() {
  return (
    <div>
      <SmartInput group="search" placeholder="Search products..." />
      <SmartInput group="comments" placeholder="Write comment..." />
      <SmartInput group="tags" placeholder="Add tags..." />
    </div>
  );
}
```

## 🎛️ Configuration

### Global Configuration

```javascript
// Configure global defaults
GhostComplete.setGroupConfig("", {
  MAX_SUGGESTIONS: 8,
  DEBOUNCE_DELAY: 200,
  MAX_WORDS: 500
});
```

### Group-Specific Configuration

```javascript
// Configure specific groups
GhostComplete.setGroupConfig("search", {
  MAX_SUGGESTIONS: 5,
  MAX_WORDS: 200
}, {
  popupContainer: "search-autocomplete-popup",
  popupRowSelected: "selected-search-suggestion"
});

GhostComplete.setGroupConfig("comments", {
  MAX_SUGGESTIONS: 10,
  DEBOUNCE_DELAY: 100
});
```

### 🔧 Complete Configuration Options

All configuration options are available through the `setGroupConfig` method:

```javascript
GhostComplete.setGroupConfig("myGroup", {
  // Performance settings
  MAX_WORDS: 300,              // Maximum words to store per group
  MAX_SUGGESTIONS: 5,          // Maximum suggestions to show in popup
  MAX_STABLE: 100,             // Stable words that won't be removed easily
  
  // Timing settings
  DEBOUNCE_DELAY: 160,         // Delay before processing input (ms)
  STORAGE_SYNC_DELAY: 600,     // Delay before saving to localStorage (ms)
  IDLE_CLEANUP_DELAY: 2000     // Delay before cleaning up unused data (ms)
}, {
  // CSS class customization
  popupContainer: "my-popup-container",     // Custom popup container class
  popupRow: "my-suggestion-row",            // Custom suggestion row class
  popupRowSelected: "my-selected-row",      // Custom selected row class
  popupHint: "my-popup-hint"                // Custom hint text class
});
```

### ⚙️ Configuration Examples

```javascript
// High-performance setup for search
GhostComplete.setGroupConfig("search", {
  MAX_SUGGESTIONS: 8,
  DEBOUNCE_DELAY: 100,
  MAX_WORDS: 500
});

// Memory-efficient setup for forms
GhostComplete.setGroupConfig("forms", {
  MAX_WORDS: 100,
  MAX_SUGGESTIONS: 3
});

// Custom styling for chat inputs
GhostComplete.setGroupConfig("chat", {
  MAX_SUGGESTIONS: 6,
  DEBOUNCE_DELAY: 80
}, {
  popupContainer: "chat-autocomplete",
  popupRowSelected: "chat-suggestion-active",
  popupHint: "chat-hint-text"
});
```

## 🧠 How Word Learning Works

GhostComplete uses a smart two-tier approach for optimal user experience:

### Word Learning & Suggestions
- **Suggestions**: Start from the first character typed (instant feedback)
- **Word Storage**: Only saves words with 3+ characters (prevents noise from short words like "a", "is", "to")
- Tracks frequently typed words with frequency scoring
- Builds a personal vocabulary per group
- Prioritizes recent and common words using time-weighted importance

```javascript
// Example learning and suggestion flow:

// User types "j"
// Suggestions: ["javascript"] (if previously learned)

// User types "ja" 
// Suggestions: ["javascript"] (refined match)

// User completes "javascript" (3+ chars saved)
// System learns: ["javascript"] with frequency: 1

// User types "js" later
// Suggestions: ["javascript"] (prefix matching from learned words)

// User types "typescript", "python" (both 3+ chars saved)
// System learns: ["javascript", "typescript", "python"]

// User types "j" again
// Suggestions: ["javascript"] (based on frequency & recency)
```

### Smart Character Handling
- **Immediate suggestions**: Any length input triggers autocomplete
- **Quality storage**: Only meaningful words (3+ characters) are permanently saved
- **Best of both worlds**: Responsive UI with clean, useful word database

## 👥 Group Management

Groups allow you to create contextual autocomplete experiences:

```javascript
// Search input group - learns search terms
GhostComplete.init('#search-input', 'search');

// Comment input group - learns comment words  
GhostComplete.init('#comment-input', 'comments');

// Tag input group - learns tag names
GhostComplete.init('#tag-input', 'tags');

// Product input group - learns product names
GhostComplete.init('#product-input', 'products');
```

### Group Benefits

- **Isolated Learning**: Each group maintains its own vocabulary
- **Context Relevance**: Suggestions are contextually appropriate
- **Better Performance**: Smaller, focused datasets for faster suggestions
- **User Privacy**: Different types of data stay in appropriate contexts

## �️ API Reference

### Core Methods

#### `GhostComplete.init(element, group)`
Initialize autocomplete for a specific element.

```javascript
// Initialize single element
GhostComplete.init('#my-input', 'forms');
GhostComplete.init(document.querySelector('.search'), 'search');
```

#### `GhostComplete.initAll(group)`
Initialize all elements with `data-autocomplete` attribute.

```javascript
// Initialize all with default group
GhostComplete.initAll();

// Initialize all with specific group
GhostComplete.initAll('comments');
```

### Configuration Methods

#### `GhostComplete.setGroupConfig(group, params, classes)`
Configure a group's behavior and styling.

```javascript
GhostComplete.setGroupConfig("search", {
  MAX_SUGGESTIONS: 5,
  DEBOUNCE_DELAY: 100,
  MAX_WORDS: 300
}, {
  popupContainer: "search-popup",
  popupRowSelected: "search-selected"
});
```

#### `GhostComplete.getGroupConfig(group)`
Retrieve current configuration for a group.

```javascript
const config = GhostComplete.getGroupConfig("search");
console.log(config.MAX_SUGGESTIONS); // 5
```

### Data Management Methods

#### `GhostComplete.clearWords(group)`
Clear learned words for a group.

```javascript
GhostComplete.clearWords("search");
```

#### `GhostComplete.clearAll(group)`
Clear all data for a group.

```javascript
GhostComplete.clearAll("comments");
```

#### `GhostComplete.listWords(group)`
Get list of learned words for a group.

```javascript
const words = GhostComplete.listWords("search");
console.log(words); // ["javascript", "typescript", "react", ...]
```

#### `GhostComplete.getStats(group)`
Get statistics about learned data.

```javascript
const stats = GhostComplete.getStats("search");
console.log(stats); // {totalWords: 145, totalEntries: 145}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `MAX_WORDS` | number | 300 | Maximum words to store per group |
| `MAX_SUGGESTIONS` | number | 5 | Maximum suggestions to show in popup |
| `MAX_STABLE` | number | 100 | Stable words that won't be removed easily |
| `DEBOUNCE_DELAY` | number | 160 | Debounce delay in milliseconds |
| `STORAGE_SYNC_DELAY` | number | 600 | LocalStorage sync delay in milliseconds |
| `IDLE_CLEANUP_DELAY` | number | 2000 | Delay before cleaning up unused data |

### CSS Class Configuration

| Class Property | Type | Description |
|---------------|------|-------------|
| `popupContainer` | string | Custom CSS class for popup container |
| `popupRow` | string | Custom CSS class for suggestion rows |
| `popupRowSelected` | string | Custom CSS class for selected suggestion row |
| `popupHint` | string | Custom CSS class for hint text |

## ⚛️ React Hook Example

Create a reusable hook for easy integration:

```jsx
import { useEffect, useRef } from 'react';
// Import GhostComplete (auto-initializes)
import 'ghostcomplete';

function useGhostComplete(group = 'default', config = {}) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      // Apply configuration
      if (Object.keys(config).length > 0) {
        GhostComplete.setGroupConfig(group, config);
      }
      
      // Initialize
      GhostComplete.init(ref.current, group);
    }

    // Cleanup is handled automatically by the library
    return () => {
      // No manual cleanup needed
    };
  }, [group, config]);

  return ref;
}

// Usage
function SmartForm() {
  const searchRef = useGhostComplete('search', { MAX_SUGGESTIONS: 8 });
  const commentRef = useGhostComplete('comments', { DEBOUNCE_DELAY: 100 });

  return (
    <form>
      <input ref={searchRef} data-autocomplete="search" type="search" />
      <textarea ref={commentRef} data-autocomplete="comments" />
    </form>
  );
}
```

## 🎯 Use Cases

### E-commerce Search
```javascript
GhostComplete.init('#product-search', 'products');
// Learns: product names, brands, categories
```

### Social Media Comments
```javascript
GhostComplete.init('.comment-input', 'social-comments');
// Learns: common phrases, words, expressions
```

### Form Filling
```javascript
GhostComplete.init('#company-input', 'companies');
GhostComplete.init('#title-input', 'job-titles');
// Learns: company names, job titles, personal info
```

### Programming IDE
```javascript
GhostComplete.init('#code-input', 'programming');
// Learns: function names, variable names, keywords
```

## 🐛 Troubleshooting

### Common Issues

**1. Autocomplete not working with React controlled inputs**
```jsx
// ✅ Ensure you're not preventing default on input events
const handleChange = (e) => {
  setValue(e.target.value); // Don't call e.preventDefault()
};
```

**2. Suggestions not appearing**
```javascript
// Check if the element is properly initialized
console.log(GhostComplete.getStats('your-group'));

// Ensure the group has learned some words
GhostComplete.listWords('your-group');
```

**3. Performance issues**
```javascript
// Reduce limits for better performance
GhostComplete.setGroupConfig('performance', {
  MAX_WORDS: 100,
  MAX_SUGGESTIONS: 3,
  DEBOUNCE_DELAY: 200
});
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/AwaisMehnga/ghostcomplete)
- [NPM Package](https://www.npmjs.com/package/ghostcomplete)
- [Documentation](https://AwaisMehnga.github.io/ghostcomplete)
- [Issues & Support](https://github.com/AwaisMehnga/ghostcomplete/issues)

---

**Made with ❤️ for React developers who want smart autocomplete that actually works.**