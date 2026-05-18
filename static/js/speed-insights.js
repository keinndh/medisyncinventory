// Vercel Speed Insights initialization
// Using ESM import from CDN for Flask/Python applications
import { injectSpeedInsights } from 'https://cdn.jsdelivr.net/npm/@vercel/speed-insights@1/+esm';

// Initialize Speed Insights
// This will automatically track Core Web Vitals and performance metrics
injectSpeedInsights();
