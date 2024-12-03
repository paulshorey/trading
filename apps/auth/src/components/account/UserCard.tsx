// import Image from 'next/image';
import { SessionData } from '@src/app/auth/actions/types';

type Props = {
  user: SessionData['user'];
};

export default function Card({ user }: Props) {
  //console.log(user)

  const greeting = user?.name ? (
    <div className="flex flex-col items-center p-6 bg-white rounded-lg font-bold text-5xl text-black">
      Hello {user?.name}!
    </div>
  ) : null;
  const emailDisplay = user?.email ? (
    <div className="flex flex-col items-center p-6 bg-white rounded-lg font-bold text-5xl text-black">
      email: {user?.email}
    </div>
  ) : null;
  const phoneDisplay = user?.phone ? (
    <div className="flex flex-col items-center p-6 bg-white rounded-lg font-bold text-5xl text-black">
      phone: {user?.phone}
    </div>
  ) : null;

  // const userImage = user?.image ? (
  //   <Image
  //     className="border-4 border-black dark:border-slate-500 drop-shadow-xl shadow-black rounded-full mx-auto mt-8"
  //     src={user?.image}
  //     width={200}
  //     height={200}
  //     alt={user?.name ?? 'Profile Pic'}
  //     priority
  //   />
  // ) : null;

  return (
    <section className="flex flex-col gap-4">
      {greeting}
      {phoneDisplay}
      {emailDisplay}
      {/* {userImage} */}
    </section>
  );
}
