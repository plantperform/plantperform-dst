type FieldErrorProps = {
  id: string
  message: string | null
}

export const FieldError = ({ id, message }: FieldErrorProps) =>
  message ? (
    <p id={id} className="text-[13px] leading-snug text-red-700">
      {message}
    </p>
  ) : null
