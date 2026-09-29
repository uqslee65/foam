export class GraphModelLink {
    static getNodeId(endpoint) {
        return typeof endpoint === 'object' ? endpoint.id : endpoint;
    }
    static getKey(link) {
        return `${GraphModelLink.getNodeId(link.source)}->${GraphModelLink.getNodeId(link.target)}`;
    }
}
