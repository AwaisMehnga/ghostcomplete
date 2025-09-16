// GhostComplete Auto-Initialization Script
// This script automatically sets up autocomplete for input and textarea elements

(function() {
  'use strict';
  
  // Check if we're in a browser environment
  if (typeof window === 'undefined') return;
  
  // Load the main library
  let ghostComplete = null;
  
  // Try to load from different possible locations
  function loadGhostComplete() {
    // If already loaded globally
    if (window.GhostComplete) {
      ghostComplete = window.GhostComplete;
      return true;
    }
    
    // Try to load from UMD build
    try {
      if (typeof require !== 'undefined') {
        ghostComplete = require('ghostcomplete/dist/index.umd.js');
      }
    } catch (e) {
      // Ignore require errors
    }
    
    // Try to load via script tag injection
    if (!ghostComplete) {
      const script = document.createElement('script');
      script.src = 'node_modules/ghostcomplete/dist/index.umd.js';
      script.onload = function() {
        ghostComplete = window.GhostComplete;
        initializeAutoComplete();
      };
      document.head.appendChild(script);
      return false; // Will initialize async
    }
    
    return true;
  }
  
  function initializeAutoComplete() {
    if (!ghostComplete) return;
    
    // Find all input and textarea elements and add autocomplete
    function setupElements() {
      const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="url"], input:not([type]), textarea');
      
      inputs.forEach(input => {
        // Skip if already has autocomplete setup
        if (input.dataset.autocomplete !== undefined) return;
        
        // Add autocomplete attribute
        input.setAttribute('data-autocomplete', 'default');
        
        // Initialize if the library has an init method
        if (typeof ghostComplete.init === 'function') {
          ghostComplete.init(input);
        }
      });
    }
    
    // Setup existing elements
    setupElements();
    
    // Watch for dynamically added elements
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(function(node) {
              if (node.nodeType === 1) { // Element node
                // Check if the added node is an input/textarea
                if (node.matches && node.matches('input[type="text"], input[type="search"], input[type="email"], input[type="url"], input:not([type]), textarea')) {
                  if (node.dataset.autocomplete === undefined) {
                    node.setAttribute('data-autocomplete', 'default');
                    if (typeof ghostComplete.init === 'function') {
                      ghostComplete.init(node);
                    }
                  }
                }
                
                // Check for input/textarea children
                const childInputs = node.querySelectorAll && node.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="url"], input:not([type]), textarea');
                if (childInputs) {
                  childInputs.forEach(input => {
                    if (input.dataset.autocomplete === undefined) {
                      input.setAttribute('data-autocomplete', 'default');
                      if (typeof ghostComplete.init === 'function') {
                        ghostComplete.init(input);
                      }
                    }
                  });
                }
              }
            });
          }
        });
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }
  
  // Initialize when DOM is ready
  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }
  
  // Start initialization
  whenReady(function() {
    if (loadGhostComplete()) {
      initializeAutoComplete();
    }
  });
  
})();