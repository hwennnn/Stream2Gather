import createWithEmailPassword from "./firebaseAuth";

interface CreateUserWithEmailPasswordrArgs {
    email: string;
    password: string;
    username: string;
}

interface CreateUserArgs {
    token: string;
    email: string;
    username: string;
}

export const createUserWithEmailPassword = async ({
    email,
    password,
    username,
}: CreateUserWithEmailPasswordrArgs) => {
    let token = await createWithEmailPassword({
        email: email,
        password: password,
    });
};
//     await createUser({
//         token,
//         email,
//         username,
//     });
// };

// const createUser = async ({ token, email, username }: CreateUserArgs) => {
//     const { mutateAsync } = useRegisterMutation({
//         meta: {
//             Authorization: `Bearer ${token}`,
//         },
//     });

//     const result = await mutateAsync({
//         options: {
//             email,
//             username,
//             token,
//         },
//     });

//     console.log(result);
// };
