import { db } from '../db/schema'

/** Delete a course and everything under it (units, lessons, progress). */
export async function deleteCourse(courseId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.learnCourses, db.learnUnits, db.learnLessons, db.learnProgress],
    async () => {
      await db.learnUnits.where('courseId').equals(courseId).delete()
      await db.learnLessons.where('courseId').equals(courseId).delete()
      await db.learnProgress.where('courseId').equals(courseId).delete()
      await db.learnCourses.delete(courseId)
    },
  )
}

/** Clear a course's progress so its lessons re-lock (lifetime stats untouched). */
export function resetCourseProgress(courseId: string): Promise<number> {
  return db.learnProgress.where('courseId').equals(courseId).delete()
}
