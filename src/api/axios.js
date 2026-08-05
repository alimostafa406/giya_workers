export const getErrorMessage = (error) => {
  return (
    error?.message ||
    error?.details ||
    error?.hint ||
    error?.error_description ||
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    'حدث خطأ غير متوقع'
  )
}
