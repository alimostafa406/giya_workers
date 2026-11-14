import { useTranslation } from '../../i18n/LanguageContext'
import { formatPayrollMoney } from '../../utils/payrollCurrency'
const money=(value,currency)=>formatPayrollMoney(value,{currency,paymentType:'weekly'})
export const displayLabels={ar:{normalOvertime:'الإضافي',doubleOvertime:'الإضافي الدوبل',netPay:'صافي القبض',basePay:'أجر العمل',transport:'النقل',doubleMarker:'دوبل'},fr:{normalOvertime:'Heures supplémentaires',doubleOvertime:'Prime double',netPay:'Net à payer',basePay:'Salaire des jours travaillés',transport:'Transport',doubleMarker:'double'},en:{normalOvertime:'Hourly overtime',doubleOvertime:'Double overtime',netPay:'Net payable',basePay:'Workday pay',transport:'Transport',doubleMarker:'double'}}
export function DoubleOvertime({days=0,amount=0,currency}) {
  const {language}=useTranslation()
  const dayWord=({ar:'يوم',fr:'j',en:'days'})[language]||'days'
  return days>0?<span className="team-report-double"><span>{days} {dayWord}</span> · <bdi dir="ltr">{money(amount,currency)}</bdi></span>:<>—</>
}
