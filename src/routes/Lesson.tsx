import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'

// Placeholder until L2 (the lesson player). Confirms the route + data load.
export default function Lesson({ lessonId }: { lessonId: string }) {
  const lesson = useLiveQuery(() => db.learnLessons.get(lessonId), [lessonId])
  return (
    <div className="page">
      <header className="topbar">
        <a className="icon-btn" href="#/learn" aria-label="Back">
          ‹
        </a>
        <span className="reader-title">{lesson?.title ?? 'lesson'}</span>
      </header>
      <main className="shelf">
        <p className="empty">
          {lesson ? `${lesson.items.length} items — the lesson player arrives in L2.` : 'lesson not found.'}
        </p>
      </main>
    </div>
  )
}
