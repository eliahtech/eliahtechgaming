// Run from a trusted external scheduler; no background timers inside Vercel.
if(!process.env.APP_URL||!process.env.JOBS_TOKEN)throw new Error('Set APP_URL and JOBS_TOKEN.');
const response=await fetch(process.env.APP_URL.replace(/\/$/,'')+'/api/v1/jobs/run',{method:'POST',headers:{Authorization:'Bearer '+process.env.JOBS_TOKEN},signal:AbortSignal.timeout(58000)});
console.log('Job status:',response.status);if(!response.ok)process.exitCode=1;
