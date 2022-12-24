export const validateEmail = (email: string): boolean => {
    let emailReg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w\w+)+$/;

    return emailReg.test(email) === true;
};

export const validateFormEmail = (email: string): string | undefined => {
    if (email === "") {
        return "Required";
    } else if (!validateEmail(email)) {
        return "Invalid email address";
    } else {
        return undefined;
    }
};
