import { useEffect, useState } from "react";
import { getRecentProjects, openStartupProject } from "../io/project";
import { newProject, openProject } from "./projectActions";

/** Started once per app launch (guards against StrictMode's double effects). */
let startup: Promise<void> | null = null;

/**
 * Shown only while the startup project (restored or new untitled) is loading,
 * or when that fails; normally the app opens straight into an untitled project.
 */
export function StartScreen() {
  const [error, setError] = useState<string | null>(null);
  const recents = getRecentProjects();

  useEffect(() => {
    startup ??= openStartupProject();
    startup.catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  return (
    <div className="start">
      <div className="start-card">
        <h1>VconBuilder</h1>
        {!error && <div className="dim">Opening…</div>}
        {error && (
          <>
            <div className="banner error">
              <span className="msg">{error}</span>
            </div>
            <div className="row">
              <button className="primary" onClick={() => void newProject()}>
                New project
              </button>
              <button onClick={() => void openProject()}>Open…</button>
            </div>
            {recents.length > 0 && (
              <>
                <div className="dim small">Recent projects</div>
                <div className="recent">
                  {recents.map((d) => (
                    <button key={d} className="ghost" title={d} onClick={() => void openProject(d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
