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

Or include via CDN:

```html
<script src="https://unpkg.com/ghostcomplete@latest/dist/ghostcomplete.min.js"></script>
```

## 🎬 Quick Start

### Basic Usage

```html
<!-- Add the data-autocomplete attribute to any input -->
<input type="text" data-autocomplete="default" placeholder="Start typing...">
<textarea data-autocomplete="comments" placeholder="Write your comment..."></textarea>

<script>
// Initialize all autocomplete inputs
GhostComplete.initAll();
</script>
```

### React Integration

```jsx
import { useEffect, useRef, useState } from 'react';

function SmartInput({ group = "default", ...props }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    // Initialize GhostComplete for this input
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

## 🧠 How Word Learning Works

GhostComplete uses a simple but effective approach:

### Word Learning
- Tracks frequently typed words
- Builds a personal vocabulary per group
- Prioritizes recent and common words
- Provides instant prefix-based suggestions

```javascript
// Example learning progression:
// Day 1: User types "javascript"
// System learns: ["javascript"]

// Day 2: User types "java" 
// Suggestions: ["javascript"]

// Day 3: User types "typescript", "python"
// System learns: ["javascript", "typescript", "python"]

// Day 4: User starts typing "j..."
// Suggestions: ["javascript"] (based on prefix matching)
```

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
console.log(stats); // {words: 145, suggestions: 12}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `MAX_WORDS` | number | 300 | Maximum words to store per group |
| `MAX_SUGGESTIONS` | number | 5 | Maximum suggestions to show |
| `DEBOUNCE_DELAY` | number | 160 | Debounce delay in milliseconds |
| `STORAGE_SYNC_DELAY` | number | 600 | LocalStorage sync delay |

## ⚛️ React Hook Example

Create a reusable hook for easy integration:

```jsx
import { useEffect, useRef } from 'react';

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

    // Cleanup
    return () => {
      // GhostComplete handles cleanup automatically
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

- [GitHub Repository](https://github.com/your-username/ghostcomplete)
- [NPM Package](https://www.npmjs.com/package/ghostcomplete)
- [Documentation](https://your-username.github.io/ghostcomplete)
- [Issues & Support](https://github.com/your-username/ghostcomplete/issues)

---

**Made with ❤️ for React developers who want smart autocomplete that actually works.**