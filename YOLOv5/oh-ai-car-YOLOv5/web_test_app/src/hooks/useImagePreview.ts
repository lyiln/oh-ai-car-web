import { useEffect } from "react"

export function useImagePreview(file: File | null, onPreviewChange: (value: string | null) => void) {
  useEffect(() => {
    if (!file) {
      onPreviewChange(null)
      return
    }

    const objectUrl = URL.createObjectURL(file)
    onPreviewChange(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, onPreviewChange])
}
