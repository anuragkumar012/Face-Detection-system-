export default function Home() {
  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-amber-100 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-600">
          Dashboard
        </p>
        <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-900">
          Face Recognition Command Center
        </h2>
        <p className="mt-4 max-w-3xl text-lg text-slate-600">
          Run the system across your network, manage enrolled users, and monitor live
          recognition from the new admin page.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h3 className="text-xl font-bold text-slate-900">Admin Page</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            View the realtime stream, inspect the latest detections, and compare them with
            enrolled user photos.
          </p>
          <p className="mt-4 text-sm font-semibold text-amber-700">Route: `/admin`</p>
        </div>

        <div className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h3 className="text-xl font-bold text-slate-900">Users</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Enroll users with a face image and store their upload information in MySQL for
            later recognition.
          </p>
          <p className="mt-4 text-sm font-semibold text-amber-700">Route: `/users`</p>
        </div>

        <div className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h3 className="text-xl font-bold text-slate-900">Recognition</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Open the live recognition page directly from another system with your LAN URL,
            such as `/recognition`.
          </p>
          <p className="mt-4 text-sm font-semibold text-amber-700">Route: `/recognition`</p>
        </div>
      </section>
    </div>
  );
}
