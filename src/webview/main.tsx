import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BgwApp } from './bgw/BgwApp';
import { QeApp } from './qe/QeApp';
import './styles.css';

const root = document.getElementById('root')!;
const app = root.dataset.app;
createRoot(root).render(app === 'qe' ? <QeApp /> : app === 'bgw' ? <BgwApp /> : <App />);
