import { useEffect, useState } from 'react'

function SupervisorForm({ initialValues, teams, onSubmit, isSaving }) {
	const [username, setUsername] = useState(initialValues?.username || '')
	const [password, setPassword] = useState('')
	const [fullName, setFullName] = useState(initialValues?.full_name || '')
	const [phone, setPhone] = useState(initialValues?.phone || '')
	const [teamId, setTeamId] = useState(initialValues?.team_id || initialValues?.team?.id || '')
	const [isActive, setIsActive] = useState(Boolean(initialValues?.is_active ?? true))

	useEffect(() => {
		setUsername(initialValues?.username || '')
		setPassword('')
		setFullName(initialValues?.full_name || '')
		setPhone(initialValues?.phone || '')
		setTeamId(initialValues?.team_id || initialValues?.team?.id || '')
		setIsActive(Boolean(initialValues?.is_active ?? true))
	}, [initialValues])

	const handleSubmit = (e) => {
		e.preventDefault()
		onSubmit({
			username,
			password,
			full_name: fullName,
			phone,
			team_id: teamId,
			is_active: isActive,
		})
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div>
				<label className="mb-1 block text-sm font-semibold">اسم المستخدم</label>
				<input
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					className="input-base"
					required
				/>
			</div>

			<div>
				<label className="mb-1 block text-sm font-semibold">
					{initialValues?.id ? 'كلمة المرور الجديدة' : 'كلمة المرور'}
				</label>
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className="input-base"
					required={!initialValues?.id}
					placeholder={initialValues?.id ? 'اتركه فارغًا للاحتفاظ بالكلمة الحالية' : ''}
				/>
			</div>

			<div>
				<label className="mb-1 block text-sm font-semibold">الاسم الكامل</label>
				<input
					value={fullName}
					onChange={(e) => setFullName(e.target.value)}
					className="input-base"
					required
				/>
			</div>

			<div>
				<label className="mb-1 block text-sm font-semibold">رقم الهاتف (اختياري)</label>
				<input
					type="tel"
					value={phone}
					onChange={(e) => setPhone(e.target.value)}
					className="input-base"
					placeholder="+243xxxxxxxxx"
				/>
			</div>

			<div>
				<label className="mb-1 block text-sm font-semibold">الفريق</label>
				<select
					value={teamId}
					onChange={(e) => setTeamId(e.target.value)}
					className="input-base"
					required
				>
					<option value="">اختر المجموعة</option>
					{teams.map((team) => (
						<option key={team.id} value={team.id}>
							{team.name}
						</option>
					))}
				</select>
			</div>

			<label className="flex items-center gap-2 rounded-xl border border-(--border) bg-white px-3 py-2 text-sm font-semibold">
				<input
					type="checkbox"
					checked={isActive}
					onChange={(e) => setIsActive(e.target.checked)}
				/>
				نشط
			</label>

			<button type="submit" className="btn-primary" disabled={isSaving}>
				{isSaving ? 'جاري الحفظ...' : 'حفظ'}
			</button>
		</form>
	)
}

export default SupervisorForm
