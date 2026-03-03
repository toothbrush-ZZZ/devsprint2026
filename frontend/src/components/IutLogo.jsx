const IutLogo = ({ size = 40 }) => {
    const borderRadius = size >= 56 ? 12 : 8;
    const padding = size >= 56 ? 6 : 4;

    return (
        <img
            src="/iut-logo.png"
            alt="Islamic University of Technology logo"
            style={{
                width: size,
                height: size,
                borderRadius,
                objectFit: 'contain',
                background: 'rgba(255,255,255,0.9)',
                padding,
                boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
            }}
        />
    );
};

export default IutLogo;

