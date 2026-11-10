import { useEffect, useState } from 'react';
import { loadAllFonts } from '../engine/fonts';
import { EditorScreen } from './editor/EditorScreen';
import { Home } from './home/Home';
import { NewProject } from './home/NewProject';
import { useRoute } from './hooks';

export function App() {
  const route = useRoute();
  const [fontsReady, setFontsReady] = useState(false);
  // The editor measures text, so fonts must be ready before it opens.
  useEffect(() => { void loadAllFonts().finally(() => setFontsReady(true)); }, []);
  if (!fontsReady) return null;
  switch (route.name) {
    case 'new': return <NewProject />;
    case 'editor': return <EditorScreen key={route.id} id={route.id} />;
    default: return <Home />;
  }
}
