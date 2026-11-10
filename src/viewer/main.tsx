import { createRoot } from 'react-dom/client';
import '../webview/styles.css';
import './viewer.css';
import { ViewerApp } from './ViewerApp';

createRoot(document.getElementById('root')!).render(<ViewerApp />);
