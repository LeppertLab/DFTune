import { createRoot } from 'react-dom/client';
import { App } from './App';
import { QeApp } from './qe/QeApp';
import './styles.css';

const root = document.getElementById('root')!;
createRoot(root).render(root.dataset.app === 'qe' ? <QeApp /> : <App />);
