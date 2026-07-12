export default function Reader({ bookId }: { bookId: string }) {
  void bookId
  return (
    <div className="page center">
      <p className="muted">
        Book not found. <a href="#/">Back to library</a>
      </p>
    </div>
  )
}
