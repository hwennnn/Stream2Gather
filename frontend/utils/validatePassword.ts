export const validatePassword = (password: string): boolean => {
    // min 12 letter password, with at least a symbol,
    // upper and lower case letters and a number
    let passwordReg = /^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{12,}$/;

    return passwordReg.test(password) === true;
};

interface ValidateFormPasswordArgs {
    password: string;
    validateComplexity?: boolean;
}

export const validateFormPassword = ({
    password,
    validateComplexity = true,
}: ValidateFormPasswordArgs): string | undefined => {
    if (password === "") {
        return "Required";
    } else if (validateComplexity && !validatePassword(password)) {
        return "Invalid password. Must be at least 12 characters long, with at least a symbol, upper and lower case letters and a number";
    } else {
        return undefined;
    }
};
