// Classic script, first in the page: records every CSP violation (the report fires on window).
window.violations = [];
document.addEventListener("securitypolicyviolation", (e) => window.violations.push({ directive: e.violatedDirective, blocked: e.blockedURI }));
